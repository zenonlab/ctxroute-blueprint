import { D1ProviderRuntimeControl, D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import {
  AniListAgendaCollector,
  MangaUpdatesAgendaCollector,
  PublicAgendaProviderError,
  bindProviderTransport,
  createPublicDiscoveryProviders,
  createPublicDiscoveryResolver,
  runPublicDiscoveryBatch,
  type PublicDiscoveryBatchReport,
  type PublicDiscoveryResultBatch,
} from '@tobirink/public-discovery';
import { D1AgendaCollectionAdapter, type AgendaLaneClaim } from './releases/public-release-collectors';
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
  readonly changed: boolean;
  readonly count: number;
  readonly revision: string;
}

export class AgendaCollectionRetryError extends Error {
  constructor(message: string, readonly retryDelaySeconds: number) { super(message); this.name = 'AgendaCollectionRetryError'; }
}

type NativeCollectorDisposition = 'ack-invalid' | 'ack-success' | 'retry' | 'retry-to-dlq';
const nativeCollectorMaxRetryRequests = 8;

interface NativeCollectorDiagnostic {
  readonly attempt: number;
  readonly code?: string;
  readonly disposition: NativeCollectorDisposition;
  readonly messageType: NativeCollectorSignal['type'] | 'invalid';
  readonly retryDelaySeconds?: number;
}

function emitNativeCollectorDiagnostic(diagnostic: NativeCollectorDiagnostic): void {
  const entry = JSON.stringify({ schemaVersion: 1, type: 'native-collector.queue', ...diagnostic });
  if (diagnostic.disposition === 'ack-success') console.log(entry);
  else console.warn(entry);
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

export function agendaCollectionFailureCode(failures: readonly string[]): string {
  const providers = new Set(failures.map((failure) => failure.split(':', 1)[0]).filter((provider) => provider === 'anilist' || provider === 'mangaupdates'));
  if (providers.has('anilist') && providers.has('mangaupdates')) return 'agenda-anilist-mangaupdates-unavailable';
  if (providers.has('anilist')) return 'agenda-anilist-unavailable';
  if (providers.has('mangaupdates')) return 'agenda-mangaupdates-unavailable';
  return 'agenda-provider-unavailable';
}

export async function processPublicDiscoveryQueue(bindings: NativeCollectorBindings): Promise<PublicDiscoveryBatchReport> {
  const port = new D1PublicDiscoveryV3Adapter(bindings.PUBLIC_DB);
  let activeToken = '';
  let followUps: readonly { key: Parameters<typeof port.confirmQueueSignal>[0]; requestDigest: string }[] = [];
  const resolver = createPublicDiscoveryResolver(createPublicDiscoveryProviders(
    providerFetch(bindings),
    new D1ProviderRuntimeControl(bindings.PUBLIC_DB),
  ));
  const report = await runPublicDiscoveryBatch({
    gateway: {
      claim: async (limit) => {
        activeToken = randomToken();
        const now = new Date();
        return port.claimBatch({ claimToken: activeToken, leaseUntil: new Date(now.valueOf() + 15 * 60_000).toISOString(), limit, now: now.toISOString(), tokenDigest: await digest(activeToken) });
      },
      publish: async (batch: PublicDiscoveryResultBatch) => {
        const receipt = await port.publishBatch(batch, await digest(activeToken), await digest(JSON.stringify(batch.results)), new Date().toISOString());
        followUps = receipt.followUps ?? [];
        return { published: receipt.published, replayed: receipt.replayed };
      },
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
  if (followUps.length > 0) {
    try {
      await bindings.PUBLIC_DISCOVERY_QUEUE.send({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json' });
      const confirmedAt = new Date().toISOString();
      await Promise.all(followUps.map((followUp) => port.confirmQueueSignal(followUp.key, followUp.requestDigest, confirmedAt)));
    } catch (error) {
      const releasedAt = new Date().toISOString();
      await Promise.all(followUps.map((followUp) => port.releaseQueueSignal(followUp.key, followUp.requestDigest, releasedAt)));
      throw error;
    }
  }
  return report;
}

function calendarWindow(scheduledFor: string): CalendarWindow {
  const scheduled = Date.parse(scheduledFor);
  if (!Number.isFinite(scheduled)) throw new TypeError('agenda-schedule-time');
  return { from: new Date(scheduled - 86_400_000).toISOString().slice(0, 10), to: new Date(scheduled + 15 * 86_400_000).toISOString().slice(0, 10) };
}

export async function processAgendaQueue(bindings: NativeCollectorBindings, scheduledFor: string): Promise<AgendaProcessingReceipt> {
  const transport = providerFetch(bindings); const window = calendarWindow(scheduledFor);
  const state = new D1AgendaCollectionAdapter(bindings.PUBLIC_DB);
  const attempts = await Promise.allSettled((['anilist', 'mangaupdates'] as const).map(async (provider) => {
    const startedAt = new Date();
    const tokenDigest = await digest(randomToken());
    const admission = await state.claimLane({
      collectionId: crypto.randomUUID(), leaseUntil: new Date(startedAt.valueOf() + 15 * 60_000).toISOString(),
      now: startedAt.toISOString(), provider, scheduledFor, tokenDigest, window,
    });
    if (admission.status === 'complete' || admission.status === 'leased') return { changed: false, collected: false, provider };
    if (admission.status === 'deferred') {
      const delay = Math.max(1, Math.ceil((Date.parse(admission.retryAt) - startedAt.valueOf()) / 1_000));
      throw new AgendaCollectionRetryError(`agenda-${provider}-unavailable`, Math.min(delay, 86_400));
    }
    const claim: AgendaLaneClaim = admission.claim;
    const checkpoint = async (page: Parameters<D1AgendaCollectionAdapter['savePage']>[1]) => state.savePage(claim, page, new Date().toISOString());
    const collector = provider === 'anilist'
      ? new AniListAgendaCollector(transport, undefined, checkpoint)
      : new MangaUpdatesAgendaCollector(transport, undefined, checkpoint);
    try {
      await collector.collect(window, { nextPage: claim.nextPage, received: claim.received, skippedUnidentified: claim.skippedUnidentified });
      const completed = await state.completeLane({ checkedAt: new Date().toISOString(), claim, provider, scheduledFor });
      return { changed: completed.changed, collected: true, provider };
    } catch (error) {
      const now = Date.now();
      const retryAt = error instanceof PublicAgendaProviderError && error.retryAt !== undefined ? error.retryAt : now + 60_000;
      await state.failLane({ claim, errorCode: `agenda-${provider}-unavailable`, provider, retryAt: new Date(retryAt).toISOString() });
      const delay = Math.max(1, Math.ceil((retryAt - now) / 1_000));
      throw new AgendaCollectionRetryError(`agenda-${provider}-unavailable`, Math.min(delay, 86_400));
    }
  }));
  const failures = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
  const completed = attempts.filter((attempt): attempt is PromiseFulfilledResult<{ changed: boolean; collected: boolean; provider: 'anilist' | 'mangaupdates' }> => attempt.status === 'fulfilled');
  const shouldPublish = completed.some((attempt) => attempt.value.collected)
    && (failures.length === 0 || completed.some((attempt) => attempt.value.changed));
  const generation = shouldPublish ? await state.publishMergedGeneration(new Date().toISOString()) : null;
  if (failures.length > 0) {
    const failureNames = failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'agenda-provider-unavailable');
    const delay = Math.max(...failures.map((failure) => failure.reason instanceof AgendaCollectionRetryError ? failure.reason.retryDelaySeconds : 60));
    throw new AgendaCollectionRetryError(agendaCollectionFailureCode(failureNames), delay);
  }
  return generation ?? { changed: false, count: 0, revision: 'd1-empty' };
}

export async function handleNativeCollectorQueue(
  messages: readonly QueueMessagePort[],
  processors: { readonly agenda: (scheduledFor: string) => Promise<AgendaProcessingReceipt>; readonly discovery: () => Promise<PublicDiscoveryBatchReport> },
): Promise<void> {
  const discoveryMessages: QueueMessagePort[] = [];
  for (const message of messages) {
    const parsedSignal = nativeCollectorSignalSchema.safeParse(message.body);
    if (!parsedSignal.success) {
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, message.attempts), code: 'collector-signal-invalid', disposition: 'ack-invalid', messageType: 'invalid' });
      message.ack();
      continue;
    }
    const signal = parsedSignal.data;
    if (signal.type === 'public-discovery-ready') {
      discoveryMessages.push(message);
      continue;
    }
    try {
      await processors.agenda(signal.scheduledFor);
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, message.attempts), disposition: 'ack-success', messageType: signal.type });
      message.ack();
    } catch (error) {
      const retryDelaySeconds = error instanceof AgendaCollectionRetryError
        ? error.retryDelaySeconds
        : Math.min(60 * (2 ** Math.max(0, message.attempts - 1)), 60 * 60);
      emitNativeCollectorDiagnostic({
        attempt: Math.max(1, message.attempts),
        code: collectorFailureCode(error instanceof Error ? error : undefined),
        disposition: message.attempts > nativeCollectorMaxRetryRequests ? 'retry-to-dlq' : 'retry',
        messageType: signal.type,
        retryDelaySeconds,
      });
      message.retry({ delaySeconds: retryDelaySeconds });
    }
  }
  if (discoveryMessages.length === 0) return;
  const [leader, ...duplicates] = discoveryMessages;
  if (!leader) return;
  try {
    const report = await processors.discovery();
    if (report.failed > 0) {
      const retryDelaySeconds = 15 * 60;
      emitNativeCollectorDiagnostic({
        attempt: Math.max(1, leader.attempts), code: 'public-discovery-partial',
        disposition: leader.attempts > nativeCollectorMaxRetryRequests ? 'retry-to-dlq' : 'retry',
        messageType: 'public-discovery-ready', retryDelaySeconds,
      });
      leader.retry({ delaySeconds: retryDelaySeconds });
    } else {
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, leader.attempts), disposition: 'ack-success', messageType: 'public-discovery-ready' });
      leader.ack();
    }
    for (const duplicate of duplicates) duplicate.ack();
  } catch (error) {
    const retryDelaySeconds = Math.min(60 * (2 ** Math.max(0, leader.attempts - 1)), 60 * 60);
    emitNativeCollectorDiagnostic({
      attempt: Math.max(1, leader.attempts), code: collectorFailureCode(error instanceof Error ? error : undefined),
      disposition: leader.attempts > nativeCollectorMaxRetryRequests ? 'retry-to-dlq' : 'retry',
      messageType: 'public-discovery-ready', retryDelaySeconds,
    });
    leader.retry({ delaySeconds: retryDelaySeconds });
    for (const duplicate of duplicates) duplicate.ack();
  }
}

export async function enqueueAgendaRefresh(controller: ScheduledController, bindings: NativeCollectorBindings): Promise<void> {
  await bindings.PUBLIC_DISCOVERY_QUEUE.send({ scheduledFor: new Date(controller.scheduledTime).toISOString(), type: 'agenda-refresh', version: 1 }, { contentType: 'json' });
}
