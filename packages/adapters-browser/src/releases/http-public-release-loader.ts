import { parsePublicReleaseSnapshot, publicReleaseEventSchema, publicReleaseSnapshotSchema } from '@tobirink/application';
import type { PublicReleaseCachePort, PublicReleaseSnapshot } from '@tobirink/application';
export interface PublicReleaseFetch { (input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
export class HttpPublicReleaseLoader {
  constructor(private readonly origin: string, private readonly fetcher: PublicReleaseFetch = fetch) {}
  async load(cache: PublicReleaseCachePort): Promise<{ snapshot: PublicReleaseSnapshot; source: 'network' | 'cache' }> {
    const cached = await cache.load();
    if (cached && Date.now() - Date.parse(cached.generatedAt) < 86_400_000) return { snapshot: parsePublicReleaseSnapshot(cached), source: 'cache' };
    const response = await this.fetcher(`${this.origin}/v2/releases?limit=100`, cached ? { headers: { 'If-None-Match': `"releases-${cached.revision}-"` } } : {});
    if (response.status === 304 && cached) return { snapshot: parsePublicReleaseSnapshot(cached), source: 'cache' };
    if (!response.ok) throw new Error(`public-release-http-${response.status}`);
    // SAFETY: the payload is parsed strictly immediately below before it enters the cache.
    const payload = await response.json() as { entries?: unknown[]; generatedAt?: string; revision?: string };
    const events = (payload.entries ?? []).map((entry) => publicReleaseEventSchema.parse(entry));
    const snapshot = parsePublicReleaseSnapshot(publicReleaseSnapshotSchema.parse({ entries: events.filter((event) => event.occurrence.kind === 'INSTANT').map((event) => ({ availability: event.state === 'ESTIMATED' ? 'estimated' : event.state === 'CANCELLED' ? 'unavailable' : 'official', label: `${event.releaseKind} ${event.sequence ?? ''}`.trim(), occursAt: event.occurrence.value, releaseId: event.id, workId: `${event.provider}:${event.providerWorkId}` })), generatedAt: payload.generatedAt ?? new Date().toISOString(), revision: payload.revision ?? 'unknown' }));
    await cache.save(snapshot);
    return { snapshot, source: 'network' };
  }
}
