import type { FavoriteProvider } from '@tobirink/public-discovery';

type SqlValue = null | number | string;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<TResult>(): Promise<TResult | null>;
}
export interface ProviderRuntimeD1Database {
  prepare(query: string): Statement;
}

export class D1ProviderRuntimeControl {
  constructor(
    private readonly database: ProviderRuntimeD1Database,
    private readonly failureThreshold = 3,
    private readonly circuitOpenMilliseconds = 15 * 60_000,
    private readonly requestTimeoutMilliseconds = 8_000,
  ) {
    if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1 || failureThreshold > 20) throw new RangeError('provider-failure-threshold-out-of-range');
    if (!Number.isSafeInteger(circuitOpenMilliseconds) || circuitOpenMilliseconds < 1_000 || circuitOpenMilliseconds > 86_400_000) throw new RangeError('provider-circuit-window-out-of-range');
    if (!Number.isSafeInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds < 1_000 || requestTimeoutMilliseconds > 60_000) throw new RangeError('provider-request-timeout-out-of-range');
  }

  async reserve(provider: FavoriteProvider, now: number, minimumIntervalMs: number): Promise<number> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 1) {
      throw new TypeError('invalid-provider-runtime-reservation');
    }
    const row = await this.database.prepare(`UPDATE public_discovery_provider_runtime SET
      next_allowed_at = CASE WHEN circuit_open_until > ?2 THEN next_allowed_at
        ELSE MAX(next_allowed_at, active_until, ?2) + ?3 END,
      active_until = CASE WHEN circuit_open_until > ?2 THEN active_until
        ELSE MAX(next_allowed_at, active_until, ?2) + ?4 END,
      updated_at = ?5
      WHERE provider = ?1
      RETURNING CASE WHEN circuit_open_until > ?2 THEN circuit_open_until
        ELSE active_until - ?4 END AS notBefore`)
      .bind(provider, now, minimumIntervalMs, this.requestTimeoutMilliseconds, new Date(now).toISOString())
      .first<{ notBefore: number }>();
    if (!row) throw new Error('provider-runtime-state-missing');
    return row.notBefore;
  }

  async recordSuccess(provider: FavoriteProvider, now: number): Promise<void> {
    const row = await this.database.prepare(`UPDATE public_discovery_provider_runtime SET
      active_until = 0, consecutive_failures = 0, circuit_open_until = 0, updated_at = ?2
      WHERE provider = ?1 RETURNING provider`)
      .bind(provider, new Date(now).toISOString()).first();
    if (!row) throw new Error('provider-runtime-state-missing');
  }

  async recordFailure(provider: FavoriteProvider, now: number, retryAt?: number): Promise<void> {
    const boundedRetryAt = retryAt !== undefined && Number.isFinite(retryAt) && retryAt > now ? retryAt : 0;
    const row = await this.database.prepare(`UPDATE public_discovery_provider_runtime SET
      active_until = 0,
      next_allowed_at = MAX(next_allowed_at, ?3),
      circuit_open_until = MAX(circuit_open_until, ?3,
        CASE WHEN consecutive_failures + 1 >= ?4 THEN ?2 + ?5 ELSE 0 END),
      consecutive_failures = consecutive_failures + 1,
      updated_at = ?6
      WHERE provider = ?1 RETURNING provider`)
      .bind(provider, now, boundedRetryAt, this.failureThreshold, this.circuitOpenMilliseconds, new Date(now).toISOString())
      .first();
    if (!row) throw new Error('provider-runtime-state-missing');
  }
}
