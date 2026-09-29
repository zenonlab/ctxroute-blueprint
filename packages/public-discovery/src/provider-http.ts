import { favoriteProviderPolicy, FavoriteProviderRetryError } from './provider-kit';
import type { FavoriteProvider } from './provider-kit';
import type { z } from 'zod';

export const favoriteProviderResponseByteLimit = 512 * 1024;
export const favoriteProviderProbeIntervalMs = 10 * 60_000;
export type FavoriteProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface FavoriteProviderJson<TValue> { readonly digest: string; readonly value: TValue }
export class FavoriteProviderHttpError extends Error {
  constructor(readonly status: number) { super(`Favorite provider request failed with HTTP ${status}.`); }
}
export function isAutomaticProviderRetry(error: Error): boolean {
  if (error instanceof FavoriteProviderHttpError) return [408, 425, 500, 502, 503, 504].includes(error.status);
  return error.name === 'AbortError' || error.name === 'TimeoutError'
    || /^(?:fetch failed|failed to fetch|network error|network request failed)$/iu.test(error.message);
}
export interface FavoriteProviderRuntimeControlPort {
  recordFailure(provider: FavoriteProvider, now: number, retryAt?: number): Promise<void>;
  recordSuccess(provider: FavoriteProvider, now: number): Promise<void>;
  reserve(provider: FavoriteProvider, now: number, minimumIntervalMs: number): Promise<{ readonly notBefore: number; readonly probeOnly: boolean }>;
}

export class FavoriteProviderRateGate {
  private active: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  constructor(
    private readonly provider: FavoriteProvider,
    private readonly controls?: FavoriteProviderRuntimeControlPort,
    private readonly clock: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }),
    private readonly probe?: () => Promise<void>,
  ) {}

  async run<TValue>(minimumIntervalMs: number, operation: () => Promise<TValue>): Promise<TValue> {
    const previous = this.active;
    let release: () => void = () => {};
    this.active = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    let operationStarted = false;
    try {
      const now = this.clock();
      const reservation = await this.controls?.reserve(this.provider, now, minimumIntervalMs)
        ?? { notBefore: Math.max(this.nextAllowedAt, now), probeOnly: false };
      const waitMs = Math.max(0, reservation.notBefore - now);
      if (waitMs > favoriteProviderPolicy.requestTimeoutMs) throw new FavoriteProviderRetryError('Provider cadence requires a later wake.', this.clock() + waitMs);
      if (waitMs > 0) await this.wait(waitMs);
      this.nextAllowedAt = this.clock() + minimumIntervalMs;
      if (reservation.probeOnly) {
        try {
          if (!this.probe) throw new Error('Provider recovery probe is not configured.');
          await this.probe();
        } catch (error) {
          const retryAt = Math.max(this.clock() + favoriteProviderProbeIntervalMs,
            error instanceof FavoriteProviderRetryError ? error.retryAt : 0);
          await this.controls?.recordFailure(this.provider, this.clock(), retryAt);
          throw new FavoriteProviderRetryError('Provider recovery probe requires a later wake.', retryAt);
        }
        await this.controls?.recordSuccess(this.provider, this.clock());
        throw new FavoriteProviderRetryError('Provider recovered; resume the checkpoint on the next wake.', this.clock() + minimumIntervalMs);
      }
      operationStarted = true;
      const value = await operation();
      operationStarted = false;
      await this.controls?.recordSuccess(this.provider, this.clock());
      return value;
    } catch (error) {
      const retryAt = error instanceof FavoriteProviderRetryError ? error.retryAt : undefined;
      if (retryAt !== undefined) this.nextAllowedAt = Math.max(this.nextAllowedAt, retryAt);
      if (operationStarted) await this.controls?.recordFailure(this.provider, this.clock(), retryAt);
      throw error;
    } finally { release(); }
  }
}

export async function readFavoriteProviderJson<TValue>(fetcher: FavoriteProviderFetch, url: string, init: RequestInit, schema: z.ZodType<TValue>, byteLimit = favoriteProviderResponseByteLimit): Promise<FavoriteProviderJson<TValue>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), favoriteProviderPolicy.requestTimeoutMs);
  try {
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error', ...init, signal: controller.signal });
    if (response.status === 429) {
      const header = response.headers.get('retry-after') ?? '';
      const delay = /^\d+$/u.test(header) ? Number(header) * 1_000 : Date.parse(header) - Date.now();
      const retryAt = Date.now() + (Number.isFinite(delay) && delay > 0 && delay < 8_000_000_000_000_000 ? delay : 60_000);
      throw new FavoriteProviderRetryError('Favorite provider request failed with HTTP 429.', retryAt);
    }
    if (!response.ok) throw new FavoriteProviderHttpError(response.status);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== undefined && contentType !== 'application/json' && !contentType.endsWith('+json')) throw new Error('Favorite provider response must be JSON.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > byteLimit) throw new Error('Favorite provider response is too large.');
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('Favorite provider response has no body.');
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    let text = ''; let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > byteLimit) throw new Error('Favorite provider response is too large.');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    return Object.freeze({ digest: digestText(text), value: schema.parse(JSON.parse(text)) });
  } finally {
    clearTimeout(timer);
  }
}

export async function readFavoriteProviderIdentityJson<TValue>(fetcher: FavoriteProviderFetch, url: string, init: RequestInit, schema: z.ZodType<TValue>): Promise<FavoriteProviderJson<TValue> | undefined> {
  try {
    return await readFavoriteProviderJson(fetcher, url, init, schema);
  } catch (error) {
    if (error instanceof FavoriteProviderHttpError && error.status === 404) return undefined;
    throw error;
  }
}

function digestText(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
