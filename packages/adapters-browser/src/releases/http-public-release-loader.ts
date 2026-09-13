import { parsePublicReleaseSnapshot, publicReleaseSnapshotSchema } from '@tobirink/application';
import type { PublicReleaseCachePort, PublicReleaseSnapshot } from '@tobirink/application';
export interface PublicReleaseFetch { (input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
export class HttpPublicReleaseLoader {
  constructor(private readonly origin: string, private readonly fetcher: PublicReleaseFetch = fetch) {}
  async load(cache: PublicReleaseCachePort): Promise<{ snapshot: PublicReleaseSnapshot; source: 'network' | 'cache' }> {
    const cached = await cache.load();
    if (cached && Date.now() - Date.parse(cached.generatedAt) < 86_400_000) return { snapshot: parsePublicReleaseSnapshot(cached), source: 'cache' };
    const response = await this.fetcher(`${this.origin}/v1/releases`, cached ? { headers: { 'If-None-Match': `"releases-${cached.revision}"` } } : {});
    if (response.status === 304 && cached) return { snapshot: parsePublicReleaseSnapshot(cached), source: 'cache' };
    if (!response.ok) throw new Error(`public-release-http-${response.status}`);
    const snapshot = parsePublicReleaseSnapshot(publicReleaseSnapshotSchema.parse(await response.json()));
    await cache.save(snapshot);
    return { snapshot, source: 'network' };
  }
}
