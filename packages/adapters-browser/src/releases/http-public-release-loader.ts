import { publicReleaseEventSchema, publicReleaseGenerationSchema } from '@tobirink/application';
import type { PublicReleaseGeneration, PublicReleaseGenerationCachePort } from '@tobirink/application';
import { z } from 'zod';
export interface PublicReleaseFetch { (input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
const pageSchema = z.strictObject({ entries: z.array(publicReleaseEventSchema).max(100), generatedAt: z.iso.datetime({ offset: false }), nextCursor: z.string().min(1).max(512).optional(), revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u), window: z.strictObject({ from: z.iso.date(), to: z.iso.date() }) });
const maximumSharedGenerationAgeMs = 8 * 86_400_000;
async function parsePage(response: Response): Promise<z.output<typeof pageSchema>> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) throw new Error('public-release-response-too-large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 1_000_000) throw new Error('public-release-response-too-large');
  try { return pageSchema.parse(JSON.parse(text)); } catch { throw new Error('public-release-response-invalid'); }
}
export class HttpPublicReleaseLoader {
  constructor(private readonly origin: string, private readonly fetcher: PublicReleaseFetch = fetch.bind(globalThis), private readonly clock: () => number = Date.now) {}
  async load(cache: PublicReleaseGenerationCachePort, window: { from: string; to: string }): Promise<{ snapshot: PublicReleaseGeneration; source: 'network' | 'cache' }> {
    const cached = await cache.load();
    const matchingCache = cached?.source === 'shared' && cached.revision !== 'd1-empty' && cached.window.from === window.from && cached.window.to === window.to ? cached : undefined;
    const matchingCacheAge = matchingCache ? this.clock() - Date.parse(matchingCache.generatedAt) : undefined;
    if (matchingCache && matchingCacheAge !== undefined && matchingCacheAge >= 0 && matchingCacheAge < 86_400_000) return { snapshot: publicReleaseGenerationSchema.parse(matchingCache), source: 'cache' };
    const events = new Map<string, PublicReleaseGeneration['events'][number]>();
    let cursor: string | undefined;
    let etag: string | undefined;
    let revision: string | undefined;
    let generatedAt: string | undefined;
    let sourceWindow: { from: string; to: string } | undefined;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const url = new URL('/v3/releases', this.origin);
      url.searchParams.set('from', window.from); url.searchParams.set('to', window.to); url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const headers = pageNumber === 1 && matchingCache ? { 'If-None-Match': matchingCache.etag } : undefined;
      let response: Response;
      try {
        response = await this.fetcher(url, headers ? { headers } : undefined);
      } catch (error) {
        if (matchingCache && matchingCacheAge !== undefined && matchingCacheAge >= 0 && matchingCacheAge < maximumSharedGenerationAgeMs) return { snapshot: publicReleaseGenerationSchema.parse(matchingCache), source: 'cache' };
        throw error;
      }
      if (response.status === 304) {
        if (pageNumber !== 1 || !matchingCache) throw new Error('public-release-unexpected-304');
        return { snapshot: publicReleaseGenerationSchema.parse(matchingCache), source: 'cache' };
      }
      if (!response.ok) {
        if (matchingCache && matchingCacheAge !== undefined && matchingCacheAge >= 0 && matchingCacheAge < maximumSharedGenerationAgeMs) return { snapshot: publicReleaseGenerationSchema.parse(matchingCache), source: 'cache' };
        throw new Error(`public-release-http-${response.status}`);
      }
      const responseEtag = response.headers.get('etag');
      if (!responseEtag || (etag !== undefined && responseEtag !== etag)) throw new Error('public-release-etag-mismatch');
      etag = responseEtag;
      const body = await parsePage(response);
      if ((revision !== undefined && body.revision !== revision) || (generatedAt !== undefined && body.generatedAt !== generatedAt)) throw new Error('public-release-generation-mismatch');
      if (sourceWindow !== undefined && (body.window.from !== sourceWindow.from || body.window.to !== sourceWindow.to)) throw new Error('public-release-generation-mismatch');
      if (body.window.from > window.from || body.window.to < window.to) throw new Error('public-release-generation-window-mismatch');
      const generationAge = this.clock() - Date.parse(body.generatedAt);
      if (generationAge < 0 || generationAge >= maximumSharedGenerationAgeMs) throw new Error('public-release-generation-stale');
      revision = body.revision; generatedAt = body.generatedAt; sourceWindow = body.window;
      for (const event of body.entries) { if (events.has(event.id)) throw new Error('public-release-duplicate-event'); events.set(event.id, event); }
      if (!body.nextCursor) {
        if (revision === 'd1-empty') throw new Error('public-release-generation-empty');
        const snapshot = publicReleaseGenerationSchema.parse({ etag, events: [...events.values()], generatedAt, revision, source: 'shared', window });
        await cache.save(snapshot);
        return { snapshot, source: 'network' };
      }
      if (body.entries.length === 0 || body.nextCursor === cursor) throw new Error('public-release-pagination-incomplete');
      cursor = body.nextCursor;
    }
    throw new Error('public-release-pagination-limit');
  }
}
