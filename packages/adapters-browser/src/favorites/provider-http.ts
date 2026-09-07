import { favoriteProviderPolicy } from '@tobirink/application';
import type { ResolutionProvider } from '@tobirink/application';
import type { z } from 'zod';

export const favoriteProviderResponseByteLimit = 64 * 1024;
export type FavoriteProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface FavoriteProviderJson<TValue> { readonly digest: string; readonly value: TValue }
export interface FavoriteProviderRateCheckpointPort {
  read(provider: ResolutionProvider): Promise<number | undefined>;
  write(provider: ResolutionProvider, nextAllowedAt: number): Promise<void>;
}

export class FavoriteProviderRateGate {
  private active: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  constructor(
    private readonly provider: ResolutionProvider,
    private readonly checkpoints?: FavoriteProviderRateCheckpointPort,
    private readonly clock: () => number = Date.now,
    private readonly wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); }),
  ) {}

  async run<TValue>(minimumIntervalMs: number, operation: () => Promise<TValue>): Promise<TValue> {
    const previous = this.active;
    let release: () => void = () => {};
    this.active = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const persisted = await this.checkpoints?.read(this.provider) ?? 0;
    const waitMs = Math.max(0, Math.max(this.nextAllowedAt, persisted) - this.clock());
    if (waitMs > 0) await this.wait(waitMs);
    this.nextAllowedAt = this.clock() + minimumIntervalMs;
    await this.checkpoints?.write(this.provider, this.nextAllowedAt);
    try { return await operation(); } finally { release(); }
  }
}

export async function readFavoriteProviderJson<TValue>(fetcher: FavoriteProviderFetch, url: string, init: RequestInit, schema: z.ZodType<TValue>): Promise<FavoriteProviderJson<TValue>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), favoriteProviderPolicy.requestTimeoutMs);
  try {
    const response = await fetcher(url, { cache: 'default', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`Favorite provider request failed with HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== undefined && contentType !== 'application/json' && !contentType.endsWith('+json')) throw new Error('Favorite provider response must be JSON.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > favoriteProviderResponseByteLimit) throw new Error('Favorite provider response is too large.');
    const text = await response.text();
    if (new TextEncoder().encode(text).length > favoriteProviderResponseByteLimit) throw new Error('Favorite provider response is too large.');
    return Object.freeze({ digest: digestText(text), value: schema.parse(JSON.parse(text)) });
  } finally {
    clearTimeout(timer);
  }
}

function digestText(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
