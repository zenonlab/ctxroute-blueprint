import type { FavoriteProvider } from '@tobirink/public-discovery';
import { FavoriteProviderRetryError } from '@tobirink/public-discovery';

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
    private readonly circuitOpenMilliseconds = 10 * 60_000,
    private readonly requestTimeoutMilliseconds = 8_000,
  ) {
    if (!Number.isSafeInteger(failureThreshold) || failureThreshold < 1 || failureThreshold > 20) throw new RangeError('provider-failure-threshold-out-of-range');
    if (!Number.isSafeInteger(circuitOpenMilliseconds) || circuitOpenMilliseconds < 1_000 || circuitOpenMilliseconds > 86_400_000) throw new RangeError('provider-circuit-window-out-of-range');
    if (!Number.isSafeInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds < 1_000 || requestTimeoutMilliseconds > 60_000) throw new RangeError('provider-request-timeout-out-of-range');
  }

  async reserve(provider: FavoriteProvider, now: number, minimumIntervalMs: number): Promise<{ readonly notBefore: number; readonly probeOnly: boolean }> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 1) {
      throw new TypeError('invalid-provider-runtime-reservation');
    }
    const row = await this.database.prepare(`UPDATE public_discovery_provider_runtime SET
      next_allowed_at = MAX(next_allowed_at, active_until, ?2) + ?3,
      active_until = MAX(next_allowed_at, active_until, ?2) + ?4,
      circuit_open_until = CASE WHEN circuit_open_until > 0 THEN ?2 + ?6 ELSE 0 END,
      updated_at = ?5
      WHERE provider = ?1 AND circuit_open_until <= ?2
        AND (circuit_open_until = 0 OR active_until <= ?2)
        AND MAX(next_allowed_at, active_until, ?2) - ?2 <= ?4
      RETURNING active_until - ?4 AS notBefore, circuit_open_until AS circuitOpenUntil`)
      .bind(provider, now, minimumIntervalMs, this.requestTimeoutMilliseconds, new Date(now).toISOString(), this.circuitOpenMilliseconds)
      .first<{ notBefore: number; circuitOpenUntil: number }>();
    if (row) return { notBefore: row.notBefore, probeOnly: row.circuitOpenUntil > 0 };
    const deferred = await this.database.prepare(`SELECT MAX(next_allowed_at, active_until, circuit_open_until, ?2) AS notBefore
      FROM public_discovery_provider_runtime WHERE provider = ?1`)
      .bind(provider, now).first<{ notBefore: number }>();
    if (!deferred) throw new Error('provider-runtime-state-missing');
    throw new FavoriteProviderRetryError('Provider reservation is deferred.', deferred.notBefore);
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
