import type { R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import { boundedDuration } from './diagnostics';

export interface QueueMetricTotals { readonly queueSends: number; readonly queueFailures: number }

export function instrumentQueueSend<T>(queue: Pick<Queue<T>, 'send'>) {
  const totals = { queueSends: 0, queueFailures: 0 };
  return {
    send: async (body: T, options?: QueueSendOptions) => {
      totals.queueSends += 1;
      try { await queue.send(body, options); }
      catch (error) { totals.queueFailures += 1; throw error; }
    },
    snapshot: (): QueueMetricTotals => Object.freeze({ ...totals }),
  };
}

export interface R2MetricTotals {
  readonly r2Reads: number;
  readonly r2Writes: number;
  readonly r2Lists: number;
  readonly r2Conflicts: number;
}

export function instrumentAgendaR2(bucket: R2Bucket) {
  const totals = { r2Reads: 0, r2Writes: 0, r2Lists: 0, r2Conflicts: 0 };
  const measured: ConstructorParameters<typeof R2AgendaOperationStore>[0] = {
    get: async key => { totals.r2Reads += 1; return bucket.get(key); },
    put: async (key, value, options) => {
      totals.r2Writes += 1;
      const result = await bucket.put(key, value, options);
      if (result === null) totals.r2Conflicts += 1;
      return result;
    },
    list: async options => { totals.r2Lists += 1; return bucket.list(options); },
  };
  return { bucket: measured, snapshot: (): R2MetricTotals => Object.freeze({ ...totals }) };
}

export interface D1MetricTotals {
  readonly rowsRead: number;
  readonly rowsWritten: number;
}

export interface InstrumentedD1 {
  readonly database: D1Database;
  calls(): number;
  snapshot(): D1MetricTotals;
}

type D1QueryMetrics = Pick<D1Meta, 'rows_read' | 'rows_written'>;

function boundedCount(value?: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function instrumentD1(database: D1Database): InstrumentedD1 {
  let rowsRead = 0;
  let rowsWritten = 0;
  let calls = 0;
  const originals = new WeakMap<object, D1PreparedStatement>();
  const record = (meta: D1QueryMetrics | undefined): void => {
    rowsRead += boundedCount(meta?.rows_read);
    rowsWritten += boundedCount(meta?.rows_written);
  };
  const wrapStatement = (statement: D1PreparedStatement): D1PreparedStatement => {
    // SAFETY: every D1PreparedStatement operation delegates to the original statement;
    // only all/run metadata is observed, and batch unwraps the exact original instance.
    const wrapped = {
      all: async <T = never>() => {
        calls += 1;
        const result = await statement.all<T>(); record(result.meta); return result;
      },
      bind: (...values: Parameters<D1PreparedStatement['bind']>) => wrapStatement(statement.bind(...values)),
      first: async <T = never>(column?: string) => {
        calls += 1;
        if (column !== undefined) return statement.first<T>(column);
        const result = await statement.all<T>(); record(result.meta); return result.results[0] ?? null;
      },
      raw: <T = never[]>(options?: { columnNames?: boolean }) => {
        calls += 1;
        // SAFETY: this compatibility branch is never used by the collector adapters and
        // forwards the public false/undefined overload without changing returned rows.
        return statement.raw<T>(options as { columnNames?: false });
      },
      run: async <T = never>() => {
        calls += 1;
        const result = await statement.run<T>(); record(result.meta); return result;
      },
    } as D1PreparedStatement;
    originals.set(wrapped, statement);
    return wrapped;
  };
  // SAFETY: the wrapped database preserves every D1Database method; prepare and batch
  // delegate to the original binding while recording only numeric result metadata.
  const instrumented = {
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
      calls += 1;
      const results = await database.batch<T>(statements.map((statement) => originals.get(statement) ?? statement));
      for (const result of results) record(result.meta);
      return results;
    },
    dump: () => { calls += 1; return database.dump(); },
    exec: (query: string) => { calls += 1; return database.exec(query); },
    prepare: (query: string) => wrapStatement(database.prepare(query)),
    withSession: (constraint?: D1SessionBookmark | D1SessionConstraint) => database.withSession(constraint),
  } as D1Database;
  return { calls: () => calls, database: instrumented, snapshot: () => Object.freeze({ rowsRead, rowsWritten }) };
}

export interface ProviderTransportMetricTotals {
  readonly providerTransportDurationMs: number;
  readonly provider429s: number;
  readonly providerHttpErrors: number;
  readonly providerNetworkErrors: number;
}

export interface ProviderMetricTotals extends ProviderTransportMetricTotals {
  readonly anilist: number;
  readonly kitsu: number;
  readonly mangadex: number;
  readonly mangaupdates: number;
}

export interface InstrumentedProviderFetch {
  readonly fetch: ProviderFetch;
  snapshot(): ProviderMetricTotals;
}

export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

function providerFromUrl(input: string): 'anilist' | 'kitsu' | 'mangadex' | 'mangaupdates' | undefined {
  const url = new URL(input);
  if (url.hostname === 'graphql.anilist.co') return 'anilist';
  if (url.hostname === 'api.mangaupdates.com') return 'mangaupdates';
  if (url.hostname === 'api.mangadex.org') return 'mangadex';
  if (url.hostname === 'kitsu.io') return 'kitsu';
  return undefined;
}

export function instrumentProviderFetch(fetcher: ProviderFetch, now = () => performance.now()): InstrumentedProviderFetch {
  const totals = { anilist: 0, kitsu: 0, mangadex: 0, mangaupdates: 0,
    providerTransportDurationMs: 0, provider429s: 0, providerHttpErrors: 0, providerNetworkErrors: 0 };
  return {
    fetch: async (input, init) => {
      const provider = providerFromUrl(input);
      if (provider === undefined) return fetcher(input, init);
      totals[provider] += 1;
      const startedAt = now();
      try {
        const response = await fetcher(input, init);
        if (response.status === 429) totals.provider429s += 1;
        if (response.status >= 400) totals.providerHttpErrors += 1;
        return response;
      } catch (error) {
        totals.providerNetworkErrors += 1;
        throw error;
      } finally {
        totals.providerTransportDurationMs = Math.min(3_600_000, totals.providerTransportDurationMs + boundedDuration(startedAt, now()));
      }
    },
    snapshot: () => Object.freeze({ ...totals }),
  };
}
