import { publicReleaseEventSchema, publicReleaseGenerationSchema } from '@tobirink/application';
import type { PublicReleaseGeneration, PublicReleaseGenerationCachePort } from '@tobirink/application';
import { z } from 'zod';
export interface PublicReleaseFetch { (input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
const pageSchema = z.strictObject({ entries: z.array(publicReleaseEventSchema).max(100), generatedAt: z.iso.datetime({ offset: false }), nextCursor: z.string().min(1).max(512).optional(), revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u) });
async function parsePage(response: Response): Promise<z.output<typeof pageSchema>> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 1_000_000) throw new Error('public-release-response-too-large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 1_000_000) throw new Error('public-release-response-too-large');
  try { return pageSchema.parse(JSON.parse(text)); } catch { throw new Error('public-release-response-invalid'); }
}
export class HttpPublicReleaseLoader {
  constructor(private readonly origin: string, private readonly fetcher: PublicReleaseFetch = fetch, private readonly clock: () => number = Date.now) {}
  async load(cache: PublicReleaseGenerationCachePort, window: { from: string; to: string }): Promise<{ snapshot: PublicReleaseGeneration; source: 'network' | 'cache' }> {
    const cached = await cache.load();
    if (cached?.source === 'shared' && cached.window.from === window.from && cached.window.to === window.to && this.clock() - Date.parse(cached.generatedAt) < 86_400_000) return { snapshot: publicReleaseGenerationSchema.parse(cached), source: 'cache' };
    const events = new Map<string, PublicReleaseGeneration['events'][number]>();
    let cursor: string | undefined;
    let etag: string | undefined;
    let revision: string | undefined;
    let generatedAt: string | undefined;
    for (let pageNumber = 1; pageNumber <= 100; pageNumber += 1) {
      const url = new URL('/v2/releases', this.origin);
      url.searchParams.set('from', window.from); url.searchParams.set('to', window.to); url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const headers = pageNumber === 1 && cached?.etag ? { 'If-None-Match': cached.etag } : undefined;
      const response = await this.fetcher(url, headers ? { headers } : undefined);
      if (response.status === 304 && pageNumber === 1 && cached) return { snapshot: publicReleaseGenerationSchema.parse(cached), source: 'cache' };
      if (!response.ok) throw new Error(`public-release-http-${response.status}`);
      const responseEtag = response.headers.get('etag');
      if (!responseEtag || (etag !== undefined && responseEtag !== etag)) throw new Error('public-release-etag-mismatch');
      etag = responseEtag;
      const body = await parsePage(response);
      if ((revision !== undefined && body.revision !== revision) || (generatedAt !== undefined && body.generatedAt !== generatedAt)) throw new Error('public-release-generation-mismatch');
      revision = body.revision; generatedAt = body.generatedAt;
      for (const event of body.entries) { if (events.has(event.id)) throw new Error('public-release-duplicate-event'); events.set(event.id, event); }
      if (!body.nextCursor) {
        if (events.size === 0) throw new Error('public-release-generation-empty');
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
