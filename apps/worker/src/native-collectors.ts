import { D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import {
  AniListAgendaCollector,
  MangaUpdatesAgendaCollector,
  bindProviderTransport,
  collectPublicAgendaLanes,
  createPublicDiscoveryProviders,
  createPublicDiscoveryResolver,
  publicAgendaIngestionSchema,
  runPublicDiscoveryBatch,
  type PublicDiscoveryBatchReport,
  type PublicDiscoveryResultBatch,
} from '@tobirink/public-discovery';
import { commitPublicReleaseGeneration } from './releases/public-release-collectors';
import { createProviderTransportAdapter, type ProviderTransportBindings } from './provider-transport-adapter';
import { z } from 'zod';

export const nativeCollectorSignalSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('public-discovery-ready'), version: z.literal(1) }),
  z.strictObject({ scheduledFor: z.iso.datetime({ offset: false }), type: z.literal('agenda-refresh'), version: z.literal(1) }),
]);
export type NativeCollectorSignal = z.infer<typeof nativeCollectorSignalSchema>;

export type NativeCollectorBindings = Env & ProviderTransportBindings & {
  readonly PUBLIC_DISCOVERY_QUEUE: Queue<NativeCollectorSignal>;
};

interface QueueMessagePort {
  readonly attempts: number;
  readonly body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface CalendarWindow {
  readonly from: string;
  readonly to: string;
}

interface AgendaProcessingReceipt {
  readonly count: number;
  readonly revision: string;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function providerFetch(bindings: NativeCollectorBindings) {
  try {
    return bindProviderTransport(createProviderTransportAdapter(bindings));
  } catch (error) {
    console.warn('provider-transport-init-failed', providerFailureCode(error instanceof Error ? error : undefined));
    throw error;
  }
}

function providerFailureCode(error: Error | undefined): string {
  if (error === undefined) return 'provider-unknown';
  if (/^provider-(gateway|transport)-/u.test(error.message)) {
    return error.message.slice(0, 80);
  }
  const status = /HTTP ([1-5]\d{2})\b/u.exec(error.message)?.[1];
  if (status !== undefined) return `provider-http-${status}`;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'provider-timeout';
  return 'provider-unavailable';
}

function collectorFailureCode(error: Error | undefined): string {
  if (error !== undefined && /^(?:public-discovery|agenda)-[a-z-]{1,64}$/u.test(error.message)) return error.message;
  if (error?.name === 'ZodError') return 'collector-schema-invalid';
  if (error !== undefined && /^D1_[A-Z_]+:/u.test(error.message)) return error.message.split('\n')[0]!.slice(0, 120);
  if (error !== undefined && /constraint failed/iu.test(error.message)) return 'collector-d1-constraint';
  if (error instanceof TypeError) {
    const detail = error.message.slice(0, 80).replaceAll(/[^A-Za-z0-9 .:_-]/gu, '?');
    return `collector-type-error:${detail}`;
  }
  return 'collector-internal';
}

export async function processPublicDiscoveryQueue(bindings: NativeCollectorBindings): Promise<PublicDiscoveryBatchReport> {
  const port = new D1PublicDiscoveryV3Adapter(bindings.PUBLIC_DB);
  let activeToken = '';
  const resolver = createPublicDiscoveryResolver(createPublicDiscoveryProviders(providerFetch(bindings)));
  return runPublicDiscoveryBatch({
    gateway: {
      claim: async (limit) => {
        activeToken = randomToken();
        const now = new Date();
        return port.claimBatch({ claimToken: activeToken, leaseUntil: new Date(now.valueOf() + 15 * 60_000).toISOString(), limit, now: now.toISOString(), tokenDigest: await digest(activeToken) });
      },
      publish: async (batch: PublicDiscoveryResultBatch) => port.publishBatch(batch, await digest(activeToken), await digest(JSON.stringify(batch.results)), new Date().toISOString()),
    },
    limit: 20,
    nonce: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    resolver: {
      resolve: async (request) => {
        try { return await resolver.resolve(request); }
        catch (error) {
          console.warn('public-discovery-provider-failed', providerFailureCode(error instanceof Error ? error : undefined));
          throw error;
        }
      },
    },
  });
}

function calendarWindow(scheduledFor: string): CalendarWindow {
  const scheduled = Date.parse(scheduledFor);
  if (!Number.isFinite(scheduled)) throw new TypeError('agenda-schedule-time');
  return { from: new Date(scheduled - 86_400_000).toISOString().slice(0, 10), to: new Date(scheduled + 15 * 86_400_000).toISOString().slice(0, 10) };
}

export async function processAgendaQueue(bindings: NativeCollectorBindings, scheduledFor: string): Promise<AgendaProcessingReceipt> {
  const transport = providerFetch(bindings); const window = calendarWindow(scheduledFor);
  const collection = await collectPublicAgendaLanes([new AniListAgendaCollector(transport), new MangaUpdatesAgendaCollector(transport)], window);
  if (collection.failures.length > 0) throw new Error('agenda-collection-incomplete');
  const ingestion = publicAgendaIngestionSchema.parse({ events: collection.events, generatedAt: scheduledFor, nonce: crypto.randomUUID(), schemaVersion: 1, window });
  const revision = `calendar-${(await digest(JSON.stringify({ events: ingestion.events, generatedAt: ingestion.generatedAt, window: ingestion.window }))).slice(0, 48)}`;
  await commitPublicReleaseGeneration(bindings.PUBLIC_DB, ingestion.events, ingestion.window, revision, ingestion.generatedAt);
  return { count: ingestion.events.length, revision };
}

export async function handleNativeCollectorQueue(
  messages: readonly QueueMessagePort[],
  processors: { readonly agenda: (scheduledFor: string) => Promise<AgendaProcessingReceipt>; readonly discovery: () => Promise<PublicDiscoveryBatchReport> },
): Promise<void> {
  for (const message of messages) {
    const parsedSignal = nativeCollectorSignalSchema.safeParse(message.body);
    if (!parsedSignal.success) { message.ack(); continue; }
    const signal = parsedSignal.data;
    try {
      if (signal.type === 'agenda-refresh') await processors.agenda(signal.scheduledFor);
      else {
        const report = await processors.discovery();
        if (report.failed > 0) { message.retry({ delaySeconds: 15 * 60 }); continue; }
      }
      message.ack();
    } catch (error) {
      console.warn('native-collector-failed', signal.type, collectorFailureCode(error instanceof Error ? error : undefined));
      message.retry({ delaySeconds: Math.min(60 * (2 ** Math.max(0, message.attempts - 1)), 60 * 60) });
    }
  }
}

export async function enqueueAgendaRefresh(controller: ScheduledController, bindings: NativeCollectorBindings): Promise<void> {
  await bindings.PUBLIC_DISCOVERY_QUEUE.send({ scheduledFor: new Date(controller.scheduledTime).toISOString(), type: 'agenda-refresh', version: 1 }, { contentType: 'json' });
}
