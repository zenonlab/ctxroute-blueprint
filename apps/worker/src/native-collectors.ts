import { D1ProviderRuntimeControl, D1PublicDiscoveryV3Adapter, R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import {
  AniListAgendaCollector,
  MangaUpdatesAgendaCollector,
  PublicAgendaProviderError,
  bindProviderTransport,
  FavoriteProviderRetryError,
  createPublicDiscoveryProviders,
  createPublicDiscoveryResolver,
  runPublicDiscoveryBatch,
  type PublicDiscoveryBatchReport,
  type PublicDiscoveryClaimedRequest,
  type PublicDiscoveryKeyV3,
  type PublicDiscoveryProviderPorts,
  type PublicDiscoveryResultBatch,
  type FavoriteProviderPort,
} from '@tobirink/public-discovery';
import { D1AgendaCollectionAdapter, type AgendaLaneClaim } from './releases/public-release-collectors';
import { createProviderTransportAdapter, type ProviderTransportBindings } from './provider-transport-adapter';
import { boundedDuration, emitWorkerCostDiagnostic, workerDiagnosticsLockValue, type WorkerCostDiagnosticEvent, type WorkerCostProvider, type WorkerCostResult } from './diagnostics';
import { instrumentAgendaR2, instrumentD1, instrumentProviderFetch, instrumentQueueSend, type D1MetricTotals, type ProviderMetricTotals, type ProviderTransportMetricTotals, type R2MetricTotals, type QueueMetricTotals } from './operational-metrics';
import { z } from 'zod';

export const nativeCollectorSignalSchema = z.discriminatedUnion('type', [
  z.strictObject({
    continuationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),
    correlationId: z.uuid().optional(),
    type: z.literal('public-discovery-ready'),
    version: z.literal(1),
  }).refine((signal) => signal.correlationId === undefined || signal.continuationToken !== undefined),
  z.strictObject({ type: z.literal('agenda-recovery'), version: z.literal(1) }),
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
  readonly metrics?: CollectorCostMetrics;
  readonly revision: string;
}

type DiscoveryProcessingReport = PublicDiscoveryBatchReport & { readonly metrics?: CollectorCostMetrics; readonly continuationScheduled?: boolean };
interface CollectorCostMetrics extends D1MetricTotals, ProviderTransportMetricTotals, Partial<R2MetricTotals>, Partial<QueueMetricTotals> {
  readonly acceptedResults: number;
  readonly pagesRequested: number;
  readonly provider: WorkerCostProvider;
  readonly providerRequests: number;
  readonly result: WorkerCostResult;
}

interface ProviderCost { readonly provider: WorkerCostProvider; readonly providerRequests: number }

function providerCost(totals: ProviderMetricTotals): ProviderCost {
  const active = [
    { provider: 'anilist' as const, requests: totals.anilist },
    { provider: 'kitsu' as const, requests: totals.kitsu },
    { provider: 'mangadex' as const, requests: totals.mangadex },
    { provider: 'mangaupdates' as const, requests: totals.mangaupdates },
  ].filter((entry) => entry.requests > 0);
  const provider: WorkerCostProvider = active.length === 0 ? 'none' : active.length === 1 ? active[0]!.provider : 'mixed';
  return { provider, providerRequests: active.reduce((sum, entry) => sum + entry.requests, 0) };
}

export function collectorCost(d1: D1MetricTotals, providers: ProviderMetricTotals, acceptedResults: number, result: WorkerCostResult, pagesRequested = 0): CollectorCostMetrics {
  const provider = providerCost(providers);
  return { ...d1, acceptedResults, pagesRequested, ...provider, result,
    providerTransportDurationMs: providers.providerTransportDurationMs,
    provider429s: providers.provider429s, providerHttpErrors: providers.providerHttpErrors, providerNetworkErrors: providers.providerNetworkErrors };
}

function emptyCollectorCost(result: WorkerCostResult): CollectorCostMetrics {
  return { acceptedResults: 0, pagesRequested: 0, provider: 'none', providerRequests: 0, result, rowsRead: 0, rowsWritten: 0,
    providerTransportDurationMs: 0, provider429s: 0, providerHttpErrors: 0, providerNetworkErrors: 0 };
}

export class AgendaCollectionRetryError extends Error {
  constructor(message: string, readonly retryDelaySeconds: number, readonly metrics?: CollectorCostMetrics) { super(message); this.name = 'AgendaCollectionRetryError'; }
}

class PublicDiscoveryProcessingError extends Error {
  constructor(readonly failure: Error | undefined, readonly metrics: CollectorCostMetrics) {
    super('public-discovery-processing-failed');
    this.name = 'PublicDiscoveryProcessingError';
  }
}

type NativeCollectorDisposition = 'ack-invalid' | 'ack-success' | 'ack-forwarded' | 'retry' | 'retry-to-dlq';
const nativeCollectorMaxRetryRequests = 8;
const publicDiscoveryResolutionTimeoutMilliseconds = 30_000;

class PublicDiscoveryInvocationBudgetError extends Error {
  constructor() { super('public-discovery-invocation-budget'); this.name = 'PublicDiscoveryInvocationBudgetError'; }
}

class PublicDiscoveryInvocationBudgetRetryError extends FavoriteProviderRetryError {
  constructor() { super('public-discovery-invocation-budget', Date.now() + 1_000); this.name = 'PublicDiscoveryInvocationBudgetRetryError'; }
}

interface NativeCollectorDiagnostic {
  readonly attempt: number;
  readonly code?: string;
  readonly disposition: NativeCollectorDisposition;
  readonly messageType: NativeCollectorSignal['type'] | 'invalid';
  readonly retryDelaySeconds?: number;
}

function emitNativeCollectorDiagnostic(diagnostic: NativeCollectorDiagnostic): void {
  const entry = JSON.stringify({ schemaVersion: 1, type: 'native-collector.queue', ...diagnostic });
  if (diagnostic.disposition === 'ack-success' || diagnostic.disposition === 'ack-forwarded') console.log(entry);
  else console.warn(entry);
}

export async function resolveWithDeadline<TValue>(operation: Promise<TValue>, timeoutMilliseconds: number): Promise<TValue> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TValue>((_resolve, reject) => {
    timer = setTimeout(() => reject(new FavoriteProviderRetryError(
      'Public discovery resolution exceeded its bounded execution window.',
      Date.now() + 60_000,
    )), timeoutMilliseconds);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createBudgetedDiscoveryResolver(
  providers: PublicDiscoveryProviderPorts,
  usedCalls: () => number,
  claimedCount: () => number,
  timeoutMilliseconds = publicDiscoveryResolutionTimeoutMilliseconds,
) {
  let completed = 0;
  let outstanding = 0;
  let exhausted = false;
  const deferred = () => new PublicDiscoveryInvocationBudgetRetryError();
  return {
    async resolve(request: PublicDiscoveryClaimedRequest) {
      const first = completed === 0;
      const scope = { closed: false, exceeded: false };
      const diagnosed = new Set<keyof PublicDiscoveryProviderPorts>();
      const operation = async <T>(run: () => Promise<T>): Promise<T> => {
        if (scope.closed) throw new Error('public-discovery-resolution-closed');
        // Publication (7) also covers this claim's alternative defer (2).
        // Reserve two for each OTHER claim, plus nextPendingAt (1).
        const otherClaims = Math.max(0, claimedCount() - completed - 1);
        if (exhausted || usedCalls() + outstanding + 4 + 7 + 2 * otherClaims + 1 > 50) {
          scope.exceeded = true;
          exhausted = true;
          throw new PublicDiscoveryInvocationBudgetError();
        }
        outstanding += 4;
        try { return await run(); }
        finally { outstanding -= 4; }
      };
      const observe = async <T>(providerName: keyof PublicDiscoveryProviderPorts, action: 'search' | 'hydrate', run: () => Promise<T>): Promise<T> => {
        try { return await run(); }
        catch (error) {
          const code = providerFailureCode(error instanceof z.ZodError || error instanceof Error ? error : undefined);
          if (!diagnosed.has(providerName) && (code.startsWith('provider-response-invalid') || code.startsWith('provider-runtime-') || code === 'provider-timeout' || code === 'provider-unavailable')) {
            diagnosed.add(providerName);
            console.warn('public-discovery-provider-operation-failed', providerName, action, code);
          }
          throw error;
        }
      };
      const wrap = (providerName: keyof PublicDiscoveryProviderPorts, provider: FavoriteProviderPort): FavoriteProviderPort => ({
        search: query => operation(() => observe(providerName, 'search', () => provider.search(query))),
        hydrate: reference => operation(() => observe(providerName, 'hydrate', () => provider.hydrate(reference))),
      });
      try {
        if (exhausted) throw deferred();
        const resolver = createPublicDiscoveryResolver({
          anilist: wrap('anilist', providers.anilist), mangaupdates: wrap('mangaupdates', providers.mangaupdates), mangadex: wrap('mangadex', providers.mangadex),
          'kitsu-anime': wrap('kitsu-anime', providers['kitsu-anime']), 'kitsu-manga': wrap('kitsu-manga', providers['kitsu-manga']),
        });
        const result = await resolveWithDeadline(resolver.resolve(request), timeoutMilliseconds);
        // The portable resolver may have caught a port error or returned a
        // fallback. A local budget refusal must override either outcome.
        if (scope.exceeded) throw new PublicDiscoveryInvocationBudgetError();
        return result;
      } catch (error) {
        if (scope.exceeded) {
          if (first) throw new PublicDiscoveryInvocationBudgetError();
          throw deferred();
        }
        throw error;
      } finally {
        scope.closed = true;
        completed += 1;
      }
    },
  };
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

export function providerFailureCode(error: Error | undefined): string {
  if (error === undefined) return 'provider-unknown';
  if (error instanceof PublicDiscoveryInvocationBudgetError || error instanceof PublicDiscoveryInvocationBudgetRetryError) return 'public-discovery-invocation-budget';
  if (error instanceof z.ZodError) {
    const fields = new Set(['titles', 'abbreviatedTitles', 'posterImage', 'canonicalTitle', 'slug', 'subtype', 'ageRating', 'status', 'startDate', 'endDate', 'userCount', 'chapterCount', 'volumeCount', 'episodeCount', 'nsfw', 'title', 'altTitles', 'contentRating', 'originalLanguage', 'tags', 'relationships', 'fileName', 'links', 'limit', 'offset', 'total', 'series_id', 'total_hits', 'associated', 'categories', 'genres', 'image', 'type', 'url']);
    const categories = new Set(['invalid_type', 'too_big', 'too_small', 'invalid_format', 'invalid_value', 'invalid_union', 'unrecognized_keys', 'custom']);
    const issue = error.issues[0];
    const field = issue?.path.find(segment => fields.has(String(segment)));
    const issueCode = issue?.code ?? 'schema';
    const category = categories.has(issueCode) ? issueCode : 'schema';
    const maximum = issue?.code === 'too_big' ? Number(issue.maximum) : NaN;
    const bound = Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= 1024 ? `-max${maximum}` : '';
    return `provider-response-invalid-${field === undefined ? 'unknown' : String(field)}-${category}${field === undefined ? bound : ''}`;
  }
  if (error instanceof SyntaxError || error.name === 'SyntaxError') return 'provider-response-invalid-json';
  if (error.message === 'Kitsu hydration returned a different media identity.') return 'provider-response-invalid-kitsu-identity';
  if (/^cover origin is not allowed for (?:anilist|mangaupdates|mangadex|kitsu-anime|kitsu-manga)$/u.test(error.message)) return 'provider-response-invalid-cover-origin';
  if (error instanceof URIError || error.name === 'URIError' || /^URI malformed\b/u.test(error.message) || /^Invalid URL\b/u.test(error.message)) return 'provider-response-invalid-uri';
  if (/^The encoded data was not valid for encoding\b/u.test(error.message)) return 'provider-response-invalid-encoding';
  if (error.message === 'provider-runtime-state-missing') return 'provider-runtime-state-missing';
  if (error.message === 'invalid-provider-runtime-reservation') return 'provider-runtime-reservation-invalid';
  if (/^D1_[A-Z_]+:/u.test(error.message)) return 'provider-runtime-d1';
  const incomplete = /^incomplete-provider-search:(deadline|candidate-page-limit|candidate-limit|cursor|page-limit)$/u.exec(error.message)?.[1];
  if (incomplete !== undefined) return `provider-search-${incomplete}`;
  if (error.message === 'Provider cadence requires a later wake.') return 'provider-cadence-deferred';
  if (error.message === 'Public discovery resolution exceeded its bounded execution window.') return 'provider-resolution-deadline';
  if (/^provider-(gateway|transport)-/u.test(error.message)) {
    return error.message.slice(0, 80);
  }
  const status = /HTTP ([1-5]\d{2})\b/u.exec(error.message)?.[1];
  if (status !== undefined) return `provider-http-${status}`;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'provider-timeout';
  if (/fetch failed|network/iu.test(error.message)) return 'provider-network';
  if (error.name === 'ZodError' || /Favorite provider response/u.test(error.message)) return 'provider-response-invalid';
  return 'provider-unavailable';
}

function collectorFailureCode(error: Error | undefined): string {
  if (error !== undefined && /^(?:public-discovery|agenda)-[a-z-]{1,64}$/u.test(error.message)) return error.message;
  if (error?.name === 'ZodError') return 'collector-schema-invalid';
  if (error !== undefined && /^D1_[A-Z_]+:/u.test(error.message)) return 'collector-d1';
  if (error !== undefined && /constraint failed/iu.test(error.message)) return 'collector-d1-constraint';
  if (error instanceof TypeError) return 'collector-type-error';
  return 'collector-internal';
}

export function agendaCollectionFailureCode(failures: readonly string[]): string {
  const providers = new Set(failures.map((failure) => failure.split(':', 1)[0]).filter((provider) => provider === 'anilist' || provider === 'mangaupdates'));
  if (providers.has('anilist') && providers.has('mangaupdates')) return 'agenda-anilist-mangaupdates-unavailable';
  if (providers.has('anilist')) return 'agenda-anilist-unavailable';
  if (providers.has('mangaupdates')) return 'agenda-mangaupdates-unavailable';
  return 'agenda-provider-unavailable';
}

export async function processPublicDiscoveryQueue(bindings: NativeCollectorBindings, key?: PublicDiscoveryKeyV3, scheduleContinuation = true, correlationId?: string, continuationToken?: string, continueGlobalWhenEmpty = false): Promise<DiscoveryProcessingReport> {
  const d1 = instrumentD1(bindings.PUBLIC_DB);
  const queue = instrumentQueueSend(bindings.PUBLIC_DISCOVERY_QUEUE);
  const providers = instrumentProviderFetch(providerFetch(bindings));
  let acceptedResults = 0;
  try {
  const port = new D1PublicDiscoveryV3Adapter(d1.database);
  let activeToken = '';
  let activeTokenDigest = '';
  let claimedCount = 0;
  const continuationTokenDigest = continuationToken === undefined ? undefined : await digest(continuationToken);
  const resolver = createBudgetedDiscoveryResolver(createPublicDiscoveryProviders(
    providers.fetch,
    new D1ProviderRuntimeControl(d1.database),
  ), d1.calls, () => claimedCount);
  const report = await runPublicDiscoveryBatch({
    gateway: {
      claim: async (limit) => {
        activeToken = randomToken();
        activeTokenDigest = await digest(activeToken);
        const now = new Date();
        const claimInput: Parameters<typeof port.claimBatch>[0] = { claimToken: activeToken, leaseUntil: new Date(now.valueOf() + 15 * 60_000).toISOString(), limit, now: now.toISOString(), tokenDigest: activeTokenDigest };
        if (continuationTokenDigest !== undefined) claimInput.continuationTokenDigest = continuationTokenDigest;
        if (key) claimInput.key = key;
        const claimed = await port.claimBatch(claimInput);
        claimedCount = claimed.requests.length;
        return claimed;
      },
      defer: (request, retryAt, now) => port.deferClaim(request, activeTokenDigest, retryAt, now),
      publish: async (batch: PublicDiscoveryResultBatch) => {
        const receipt = await port.publishBatch(batch, await digest(activeToken), await digest(JSON.stringify(batch.results)), new Date().toISOString());
        acceptedResults += receipt.published;
        return { published: receipt.published, replayed: receipt.replayed };
      },
    },
    limit: 1,
    nonce: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    resolver: {
      resolve: async (request) => {
        try { return await resolver.resolve(request); }
        catch (error) {
          console.warn('public-discovery-provider-failed', providerFailureCode(error instanceof z.ZodError || error instanceof Error ? error : undefined));
          throw error;
        }
      },
    },
  });
  const specificToken = claimedCount > 0 ? activeToken : continuationToken;
  const specificTokenDigest = claimedCount > 0 ? activeTokenDigest : continuationTokenDigest;
  const specificPendingAt = specificTokenDigest === undefined ? undefined : await port.nextPendingAt(specificTokenDigest);
  const nextPendingAt = claimedCount > 0
    ? specificPendingAt ?? await port.nextPendingAt()
    : specificPendingAt ?? (continueGlobalWhenEmpty ? await port.nextPendingAt() : undefined);
  let continuationScheduled = false;
  if (scheduleContinuation && nextPendingAt !== undefined) {
    const delaySeconds = Math.min(900, Math.max(1, Math.ceil((Date.parse(nextPendingAt) - Date.now()) / 1_000)));
    const signal: NativeCollectorSignal = specificPendingAt === undefined || specificToken === undefined
      ? { type: 'public-discovery-ready', version: 1 }
      : correlationId === undefined
        ? { continuationToken: specificToken, type: 'public-discovery-ready', version: 1 }
        : { continuationToken: specificToken, correlationId, type: 'public-discovery-ready', version: 1 };
    try {
      await queue.send(signal, { contentType: 'json', delaySeconds });
      continuationScheduled = true;
    } catch {
      console.warn('public-discovery-continuation-unsent');
    }
  }
  const result = report.replayed > 0 && report.published === 0 ? 'deduplicated' : report.published > 0 ? 'changed' : (report.deferred ?? 0) > 0 ? 'backoff' : 'unchanged';
  return { ...report, continuationScheduled, metrics: { ...collectorCost(d1.snapshot(), providers.snapshot(), report.published, result), ...queue.snapshot() } };
  } catch (error) {
    throw new PublicDiscoveryProcessingError(error instanceof Error ? error : undefined, { ...collectorCost(d1.snapshot(), providers.snapshot(), acceptedResults, 'failed'), ...queue.snapshot() });
  }
}

function calendarWindow(scheduledFor: string): CalendarWindow {
  const scheduled = Date.parse(scheduledFor);
  if (!Number.isFinite(scheduled)) throw new TypeError('agenda-schedule-time');
  return { from: new Date(scheduled - 86_400_000).toISOString().slice(0, 10), to: new Date(scheduled + 15 * 86_400_000).toISOString().slice(0, 10) };
}

export async function processAgendaQueue(bindings: NativeCollectorBindings, scheduledFor: string): Promise<AgendaProcessingReceipt> {
  const d1 = instrumentD1(bindings.PUBLIC_DB);
  let lazyProvider: ReturnType<typeof providerFetch> | undefined;
  const providers = instrumentProviderFetch((input, init) => {
    lazyProvider ??= providerFetch(bindings);
    return lazyProvider(input, init);
  });
  let pagesRequested = 0;
  const transport = async (input: string, init: RequestInit) => { pagesRequested += 1; return providers.fetch(input, init); };
  const r2 = instrumentAgendaR2(bindings.RELEASE_SNAPSHOTS);
  const operations = new R2AgendaOperationStore(r2.bucket, undefined, () => new Date().toISOString());
  try {
  const effectiveSchedule = await operations.pendingSignal() ?? scheduledFor;
  const window = calendarWindow(effectiveSchedule);
  const state = new D1AgendaCollectionAdapter(d1.database, operations);
  const attempts = await Promise.allSettled((['anilist', 'mangaupdates'] as const).map(async (provider) => {
    const startedAt = new Date();
    const tokenDigest = await digest(randomToken());
    const admission = await state.claimLane({
      collectionId: crypto.randomUUID(), leaseUntil: new Date(startedAt.valueOf() + 15 * 60_000).toISOString(),
      now: startedAt.toISOString(), provider, scheduledFor: effectiveSchedule, tokenDigest, window,
    });
    if (admission.status === 'complete') return { accepted: 0, changed: false, collected: false, provider };
    if (admission.status === 'ready') return { accepted: 0, changed: true, collected: true, provider };
    if (admission.status === 'deferred' || admission.status === 'leased') {
      const delay = Math.max(1, Math.ceil((Date.parse(admission.retryAt ?? new Date(startedAt.valueOf() + 60_000).toISOString()) - startedAt.valueOf()) / 1_000));
      throw new AgendaCollectionRetryError(`agenda-${provider}-unavailable`, Math.min(delay, 86_400));
    }
    const claim: AgendaLaneClaim = admission.claim;
    const checkpoint = async (page: Parameters<D1AgendaCollectionAdapter['savePage']>[1]) => state.savePage(claim, page, new Date().toISOString());
    const collector = provider === 'anilist'
      ? new AniListAgendaCollector(transport, undefined, checkpoint)
      : new MangaUpdatesAgendaCollector(transport, undefined, checkpoint);
    try {
      if (claim.collectionComplete !== true) await collector.collect(window, { nextPage: claim.nextPage, received: claim.received, skippedUnidentified: claim.skippedUnidentified });
      const completed = await state.completeLane({ checkedAt: new Date().toISOString(), claim, provider, scheduledFor: effectiveSchedule });
      return { accepted: completed.events.length, changed: completed.changed, collected: true, provider };
    } catch (error) {
      const now = Date.now();
      const retryAt = error instanceof PublicAgendaProviderError && error.retryAt !== undefined ? error.retryAt : now + 60_000;
      await state.failLane({ claim, errorCode: `agenda-${provider}-unavailable`, provider, retryAt: new Date(retryAt).toISOString() });
      const delay = Math.max(1, Math.ceil((retryAt - now) / 1_000));
      throw new AgendaCollectionRetryError(`agenda-${provider}-unavailable`, Math.min(delay, 86_400));
    }
  }));
  const failures = attempts.filter((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
  const completed = attempts.filter((attempt): attempt is PromiseFulfilledResult<{ accepted: number; changed: boolean; collected: boolean; provider: 'anilist' | 'mangaupdates' }> => attempt.status === 'fulfilled');
  const shouldPublish = completed.some((attempt) => attempt.value.collected)
    && (failures.length === 0 || completed.some((attempt) => attempt.value.changed));
  let generation: Awaited<ReturnType<D1AgendaCollectionAdapter['publishMergedGeneration']>> = null;
  try {
    generation = shouldPublish ? await state.publishMergedGeneration(new Date().toISOString()) : null;
  } catch {
    throw new AgendaCollectionRetryError('agenda-publication-unavailable', 60, { ...collectorCost(d1.snapshot(), providers.snapshot(), 0, 'failed', pagesRequested), ...r2.snapshot() });
  }
  if (failures.length > 0) {
    const failureNames = failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : 'agenda-provider-unavailable');
    const delay = Math.max(...failures.map((failure) => failure.reason instanceof AgendaCollectionRetryError ? failure.reason.retryDelaySeconds : 60));
    const accepted = completed.reduce((sum, attempt) => sum + attempt.value.accepted, 0);
    throw new AgendaCollectionRetryError(agendaCollectionFailureCode(failureNames), delay, { ...collectorCost(d1.snapshot(), providers.snapshot(), accepted, 'backoff', pagesRequested), ...r2.snapshot() });
  }
  const receipt = generation ?? { changed: false, count: 0, revision: 'd1-empty' };
  await operations.finishSignal(effectiveSchedule);
  const result: WorkerCostResult = generation === null ? 'deduplicated' : receipt.changed ? 'changed' : 'unchanged';
  return { ...receipt, metrics: { ...collectorCost(d1.snapshot(), providers.snapshot(), receipt.count, result, pagesRequested), ...r2.snapshot() } };
  } catch (error) {
    if (error instanceof AgendaCollectionRetryError && error.metrics !== undefined) throw error;
    throw new AgendaCollectionRetryError(error instanceof AgendaCollectionRetryError ? error.message : 'agenda-operation-unavailable',
      error instanceof AgendaCollectionRetryError ? error.retryDelaySeconds : 60,
      { ...collectorCost(d1.snapshot(), providers.snapshot(), 0, 'failed', pagesRequested), ...r2.snapshot() });
  }
}

export async function handleNativeCollectorQueue(
  messages: readonly QueueMessagePort[],
  processors: { readonly agenda: (scheduledFor: string) => Promise<AgendaProcessingReceipt>; readonly discovery: (correlationId?: string, continuationToken?: string) => Promise<DiscoveryProcessingReport>; readonly recovery?: () => Promise<void>; readonly forward?: (signal: NativeCollectorSignal) => Promise<void> },
): Promise<void> {
  const groups: { signal: NativeCollectorSignal; messages: QueueMessagePort[] }[] = [];
  for (const message of messages) {
    const parsedSignal = nativeCollectorSignalSchema.safeParse(message.body);
    if (!parsedSignal.success) {
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, message.attempts), code: 'collector-signal-invalid', disposition: 'ack-invalid', messageType: 'invalid' });
      message.ack();
      continue;
    }
    const signal = parsedSignal.data;
    const group = groups.find(candidate => candidate.signal.type === signal.type
      && (signal.type === 'public-discovery-ready'
        ? candidate.signal.type === 'public-discovery-ready'
          && candidate.signal.correlationId === signal.correlationId
          && candidate.signal.continuationToken === signal.continuationToken
        : signal.type !== 'agenda-refresh' || (candidate.signal.type === 'agenda-refresh' && candidate.signal.scheduledFor === signal.scheduledFor)));
    if (group) group.messages.push(message);
    else groups.push({ signal, messages: [message] });
  }
  const [selected, ...deferredGroups] = groups;
  if (!selected) return;
  // Each collector owns one D1 invocation budget. Preserve other signal groups
  // durably before acknowledging them instead of spending their retry attempts.
  for (const group of deferredGroups) {
    const [leader, ...duplicates] = group.messages;
    if (!leader) continue;
    try {
      if (!processors.forward) throw new Error('collector-forward-unavailable');
      await processors.forward(group.signal);
      leader.ack();
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, leader.attempts), disposition: 'ack-forwarded', messageType: group.signal.type });
    } catch {
      const retryDelaySeconds = Math.min(60 * (2 ** Math.max(0, leader.attempts - 1)), 60 * 60);
      leader.retry({ delaySeconds: retryDelaySeconds });
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, leader.attempts), code: 'collector-forward-failed',
        disposition: leader.attempts > nativeCollectorMaxRetryRequests ? 'retry-to-dlq' : 'retry', messageType: group.signal.type, retryDelaySeconds });
    }
    for (const duplicate of duplicates) duplicate.ack();
  }
  const discoveryMessages: QueueMessagePort[] = [];
  for (const [index, message] of selected.messages.entries()) {
    const signal = selected.signal;
    if (signal.type === 'public-discovery-ready') {
      discoveryMessages.push(message);
      continue;
    }
    if (index > 0) { message.ack(); continue; }
    const startedAt = Date.now();
    try {
      if (signal.type === 'agenda-recovery') {
        if (processors.recovery === undefined) throw new Error('agenda-recovery-unavailable');
        await processors.recovery();
      } else {
        const receipt = await processors.agenda(signal.scheduledFor);
        emitCollectorCost('agenda', receipt.metrics ?? emptyCollectorCost(receipt.changed ? 'changed' : 'unchanged'), startedAt, message.attempts);
      }
      emitNativeCollectorDiagnostic({ attempt: Math.max(1, message.attempts), disposition: 'ack-success', messageType: signal.type });
      message.ack();
    } catch (error) {
      const retryDelaySeconds = error instanceof AgendaCollectionRetryError
        ? error.retryDelaySeconds
        : Math.min(60 * (2 ** Math.max(0, message.attempts - 1)), 60 * 60);
      if (signal.type !== 'agenda-recovery') emitCollectorCost('agenda', error instanceof AgendaCollectionRetryError && error.metrics !== undefined ? error.metrics : emptyCollectorCost('failed'), startedAt, message.attempts);
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
  const startedAt = Date.now();
  const correlationId = selected.signal.type === 'public-discovery-ready' ? selected.signal.correlationId : undefined;
  const continuationToken = selected.signal.type === 'public-discovery-ready' ? selected.signal.continuationToken : undefined;
  try {
    const report = await processors.discovery(correlationId, continuationToken);
    if (report.failed > 0 && report.continuationScheduled !== true) {
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
    const metrics = report.metrics ?? emptyCollectorCost(report.failed > 0 ? 'backoff' : 'unchanged');
    emitCollectorCost('discovery', report.failed > 0 ? { ...metrics, result: 'backoff' } : metrics, startedAt, leader.attempts, correlationId);
    for (const duplicate of duplicates) duplicate.ack();
  } catch (error) {
    const retryDelaySeconds = Math.min(60 * (2 ** Math.max(0, leader.attempts - 1)), 60 * 60);
    const failure = error instanceof PublicDiscoveryProcessingError ? error.failure : error instanceof Error ? error : undefined;
    emitNativeCollectorDiagnostic({
      attempt: Math.max(1, leader.attempts), code: collectorFailureCode(failure),
      disposition: leader.attempts > nativeCollectorMaxRetryRequests ? 'retry-to-dlq' : 'retry',
      messageType: 'public-discovery-ready', retryDelaySeconds,
    });
    leader.retry({ delaySeconds: retryDelaySeconds });
    emitCollectorCost('discovery', error instanceof PublicDiscoveryProcessingError ? error.metrics : emptyCollectorCost('failed'), startedAt, leader.attempts);
    for (const duplicate of duplicates) duplicate.ack();
  }
}

function emitCollectorCost(task: 'agenda' | 'agenda-admission' | 'agenda-recovery' | 'discovery', metrics: CollectorCostMetrics, startedAt: number, attempt: number, correlationId?: string): void {
  const agendaCounters = task === 'agenda'
    ? { generationsAvoided: metrics.result === 'unchanged' ? 1 : 0, generationsCreated: metrics.result === 'changed' ? 1 : 0 }
    : {};
  const event: WorkerCostDiagnosticEvent = {
    acceptedResults: metrics.acceptedResults,
    d1RowsRead: metrics.rowsRead,
    d1RowsWritten: metrics.rowsWritten,
    durationMs: boundedDuration(startedAt, Date.now()),
    pagesRequested: metrics.pagesRequested,
    provider: metrics.provider,
    providerRequests: metrics.providerRequests,
    providerTransportDurationMs: metrics.providerTransportDurationMs,
    provider429s: metrics.provider429s,
    providerHttpErrors: metrics.providerHttpErrors,
    providerNetworkErrors: metrics.providerNetworkErrors,
    result: metrics.result,
    retries: Math.max(0, attempt - 1),
    r2Reads: metrics.r2Reads ?? 0,
    r2Writes: metrics.r2Writes ?? 0,
    r2Lists: metrics.r2Lists ?? 0,
    r2Conflicts: metrics.r2Conflicts ?? 0,
    queueSends: metrics.queueSends ?? 0,
    queueFailures: metrics.queueFailures ?? 0,
    schemaVersion: 1,
    task,
    type: 'worker.cost',
    ...agendaCounters,
  };
  if (correlationId !== undefined) Object.assign(event, { correlationId });
  emitWorkerCostDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue }, event);
}

export async function enqueueAgendaRefresh(controller: ScheduledController, bindings: NativeCollectorBindings): Promise<void> {
  const startedAt = Date.now();
  const r2 = instrumentAgendaR2(bindings.RELEASE_SNAPSHOTS);
  const scheduledFor = new Date(controller.scheduledTime).toISOString();
  const now = new Date().toISOString();
  let result: WorkerCostResult = 'failed';
  try {
    await new R2AgendaOperationStore(r2.bucket).writePendingSignal({ scheduledFor, ownerToken: randomToken(), now });
    result = 'changed';
  } finally {
    emitCollectorCost('agenda-admission', { ...emptyCollectorCost(result), ...r2.snapshot() }, startedAt, 1);
  }
  await recoverPendingAgenda(bindings);
}

export async function recoverPendingAgenda(bindings: NativeCollectorBindings): Promise<void> {
  const startedAt = Date.now();
  const r2 = instrumentAgendaR2(bindings.RELEASE_SNAPSHOTS);
  const queue = instrumentQueueSend(bindings.PUBLIC_DISCOVERY_QUEUE);
  const operations = new R2AgendaOperationStore(r2.bucket);
  let result: WorkerCostResult = 'failed';
  try {
    const scanRemaining = await operations.recoverLegacySignals();
    const oldest = await operations.pendingSignal();
    if (oldest !== undefined && Date.now() - Date.parse(oldest) > 8 * 86_400_000) {
      console.warn(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'agenda-recovery-overdue' }));
    }
    const scheduledFor = await operations.reserveSignalDelivery(new Date().toISOString());
    if (scheduledFor !== undefined) await queue.send({ scheduledFor, type: 'agenda-refresh', version: 1 }, { contentType: 'json', delaySeconds: 60 });
    else if (scanRemaining) await queue.send({ type: 'agenda-recovery', version: 1 }, { contentType: 'json', delaySeconds: 60 });
    result = scheduledFor === undefined && !scanRemaining ? 'deduplicated' : 'changed';
  } catch (error) {
    console.warn(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'agenda-recovery-failed' }));
    throw error;
  } finally {
    emitCollectorCost('agenda-recovery', { ...emptyCollectorCost(result), ...r2.snapshot(), ...queue.snapshot() }, startedAt, 1);
  }
}
