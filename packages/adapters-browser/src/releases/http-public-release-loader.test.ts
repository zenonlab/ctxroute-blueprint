import { describe, expect, it, vi } from 'vitest';
import { HttpPublicReleaseLoader } from './http-public-release-loader';

describe('HttpPublicReleaseLoader', () => {
  it('keeps the last good cache on 304 and avoids a write', async () => {
    const snapshot = { entries: [], generatedAt: new Date().toISOString(), revision: 'r1' };
    const cache = { load: async () => snapshot, save: vi.fn() };
    const loader = new HttpPublicReleaseLoader('https://tobirink.com', async (_input, init) => { expect(init?.headers).toEqual({ 'If-None-Match': '"releases-r1"' }); return new Response(null, { status: 304 }); });
    expect((await loader.load(cache)).source).toBe('cache'); expect(cache.save).not.toHaveBeenCalled();
  });
});
