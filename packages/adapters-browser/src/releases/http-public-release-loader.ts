import { projectVirtualAgenda, publicReleaseEventSchema, publicReleaseGenerationSchema, virtualReleaseModelSchema } from '@tobirink/application';
import type { PublicReleaseGeneration, PublicReleaseGenerationCachePort, VirtualReleaseModelContract } from '@tobirink/application';
import { z } from 'zod';
export interface PublicReleaseFetch { (input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
const pageSchema = z.strictObject({ models: z.array(virtualReleaseModelSchema).max(100), generatedAt: z.iso.datetime({ offset: false }), nextCursor: z.string().min(1).max(128).optional(), revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u), window: z.strictObject({ from: z.iso.date(), to: z.iso.date() }) });
const historyPageSchema = pageSchema.omit({ models: true, nextCursor: true }).extend({ entries: z.array(publicReleaseEventSchema).max(100), nextCursor: z.string().min(1).max(256).optional() });
const responsePageSchema = z.union([pageSchema, historyPageSchema]);
const maximumSharedGenerationAgeMs = 8 * 86_400_000;
async function parsePage(response: Response): Promise<z.output<typeof responsePageSchema>> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) throw new Error('public-release-response-too-large');
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('public-release-response-invalid');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = ''; let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1_000_000) throw new Error('public-release-response-too-large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  try { return responsePageSchema.parse(JSON.parse(text)); } catch { throw new Error('public-release-response-invalid'); }
}
export class HttpPublicReleaseLoader {
  constructor(private readonly origin: string, private readonly fetcher: PublicReleaseFetch = fetch.bind(globalThis), private readonly clock: () => number = Date.now) {}
  private async request(url: URL, etag: string | undefined, timeout: number) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const init: RequestInit = { signal: controller.signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' };
          if (etag !== undefined) init.headers = { 'If-None-Match': etag };
          const response = await this.fetcher(url, init);
          return { response, body: response.ok ? await parsePage(response) : undefined };
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('public-release-timeout')); }, timeout); }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  async load(cache: PublicReleaseGenerationCachePort, window: { from: string; to: string }): Promise<{ snapshot: PublicReleaseGeneration; source: 'network' | 'cache'; freshness: 'current' | 'stale' }> {
    const cached = await cache.load();
    const sameWindow = cached?.window.from === window.from && cached.window.to === window.to;
    const legacyCovered = cached?.models === undefined && cached !== undefined && cached.window.from <= window.from && cached.window.to >= window.to;
    const covered = cached?.models !== undefined && cached.modelWindow !== undefined && cached.modelWindow.from <= window.from && cached.modelWindow.to >= window.to;
    const matchingCache = cached?.source === 'shared' && cached.revision !== 'd1-empty' && (sameWindow || covered || legacyCovered)
      ? publicReleaseGenerationSchema.parse(covered ? { ...cached, events: projectVirtualAgenda(cached.models!, window), window } : cached) : undefined;
    const matchingCacheAge = matchingCache ? this.clock() - Date.parse(matchingCache.generatedAt) : undefined;
    if (matchingCache && matchingCacheAge !== undefined && matchingCacheAge >= 0 && matchingCacheAge < 86_400_000) {
      if (!sameWindow && covered) await cache.save(matchingCache);
      return { snapshot: matchingCache, source: 'cache', freshness: 'current' };
    }
    const deadline = this.clock() + 20_000;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          try { return await this.download(cache, window, matchingCache, deadline, 'models'); }
          catch (error) {
            if (!(error instanceof Error) || error.message !== 'public-release-models-uninitialized') throw error;
            return await this.download(cache, window, matchingCache, deadline, 'history');
          }
        }
        catch (error) { if (!(error instanceof Error) || error.message !== 'public-release-generation-mismatch' || attempt > 0) throw error; }
      }
      throw new Error('public-release-generation-mismatch');
    } catch (error) {
      if (matchingCache && matchingCacheAge !== undefined && matchingCacheAge >= 0 && matchingCacheAge < maximumSharedGenerationAgeMs) {
        if (!sameWindow && covered) await cache.save(matchingCache);
        return { snapshot: matchingCache, source: 'cache', freshness: 'stale' };
      }
      throw error;
    }
  }
  private async download(cache: PublicReleaseGenerationCachePort, window: { from: string; to: string }, matchingCache: PublicReleaseGeneration | undefined, deadline: number, mode: 'models' | 'history'): Promise<{ snapshot: PublicReleaseGeneration; source: 'network' | 'cache'; freshness: 'current' }> {
    const models = new Map<string, VirtualReleaseModelContract>();
    const historicalEvents = new Map<string, PublicReleaseGeneration['events'][number]>();
    let cursor: string | undefined;
    let etag: string | undefined;
    let revision: string | undefined;
    let generatedAt: string | undefined;
    let sourceWindow: { from: string; to: string } | undefined;
    let bytes = 0;
    const cursors = new Set<string>();
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const url = new URL(mode === 'models' ? '/v4/release-models' : '/v3/releases', this.origin);
      if (mode === 'models') url.searchParams.set('representation', 'pages');
      url.searchParams.set('from', window.from); url.searchParams.set('to', window.to); url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const remaining = deadline - this.clock();
      if (remaining < 1000) throw new Error('public-release-wake-budget');
      const validatorWindow = matchingCache?.modelWindow ?? matchingCache?.window;
      const sameRepresentation = mode === 'models' ? matchingCache?.models !== undefined : matchingCache?.models === undefined;
      const validator = sameRepresentation && pageNumber === 1 && validatorWindow?.from === window.from && validatorWindow.to === window.to ? matchingCache?.etag : undefined;
      const { response, body } = await this.request(url, validator, Math.min(10_000, remaining));
      if (response.status === 304) {
        if (pageNumber !== 1 || !matchingCache || validator === undefined) throw new Error('public-release-unexpected-304');
        const age = this.clock() - Date.parse(matchingCache.generatedAt);
        if (age < 0 || age >= maximumSharedGenerationAgeMs) throw new Error('public-release-generation-stale');
        return { snapshot: matchingCache, source: 'cache', freshness: 'current' };
      }
      if (!response.ok) {
        throw new Error(`public-release-http-${response.status}`);
      }
      const responseEtag = response.headers.get('etag');
      if (!responseEtag || body === undefined) throw new Error('public-release-etag-mismatch');
      if ((mode === 'models') !== ('models' in body)) throw new Error('public-release-response-invalid');
      if (mode === 'models' && 'models' in body && body.models.length === 0 && body.nextCursor === undefined && body.generatedAt === '1970-01-01T00:00:00.000Z') throw new Error('public-release-models-uninitialized');
      etag ??= responseEtag;
      bytes += new TextEncoder().encode(JSON.stringify(body)).byteLength;
      if (bytes > 10_000_000) throw new Error('public-release-response-too-large');
      if ((revision !== undefined && body.revision !== revision) || (generatedAt !== undefined && body.generatedAt !== generatedAt)) throw new Error('public-release-generation-mismatch');
      if (sourceWindow !== undefined && (body.window.from !== sourceWindow.from || body.window.to !== sourceWindow.to)) throw new Error('public-release-generation-mismatch');
      if (body.window.from > window.from || body.window.to < window.to) throw new Error('public-release-generation-window-mismatch');
      const generationAge = this.clock() - Date.parse(body.generatedAt);
      if (generationAge < 0 || generationAge >= maximumSharedGenerationAgeMs) throw new Error('public-release-generation-stale');
      revision = body.revision; generatedAt = body.generatedAt; sourceWindow = body.window;
      if ('models' in body) for (const model of body.models) { if (models.has(model.workId)) throw new Error('public-release-duplicate-model'); models.set(model.workId, model); }
      if ('entries' in body) for (const event of body.entries) { if (historicalEvents.has(event.id)) throw new Error('public-release-duplicate-event'); historicalEvents.set(event.id, event); }
      if (!body.nextCursor) {
        if (revision === 'models-0-0') throw new Error('public-release-generation-empty');
        const events = mode === 'models' ? projectVirtualAgenda([...models.values()], window) : [...historicalEvents.values()];
        const generation = { etag, events, generatedAt, revision, source: 'shared', window };
        const snapshot = publicReleaseGenerationSchema.parse(mode === 'models' ? { ...generation, models: [...models.values()], modelWindow: sourceWindow } : generation);
        await cache.save(snapshot);
        return { snapshot, source: 'network', freshness: 'current' };
      }
      if (('models' in body ? body.models : body.entries).length === 0 || cursors.has(body.nextCursor)) throw new Error('public-release-pagination-incomplete');
      cursors.add(body.nextCursor);
      cursor = body.nextCursor;
    }
    throw new Error('public-release-pagination-limit');
  }
}
