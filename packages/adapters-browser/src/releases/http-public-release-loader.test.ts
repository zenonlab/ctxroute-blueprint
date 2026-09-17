import { describe, expect, it, vi } from 'vitest';
import type { PublicReleaseGeneration, VirtualReleaseModelContract } from '@tobirink/application';
import { HttpPublicReleaseLoader } from './http-public-release-loader';

const releaseEvent = (id: string, instant: string): PublicReleaseGeneration['events'][number] => ({ expiresAt: '2026-11-12T00:00:00.000Z', id, occurrence: { kind: 'INSTANT', value: instant }, provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist', providerWorkId: '42', releaseKind: 'episode', state: 'SCHEDULED' });
const releaseModel = (workId: string, id: string, instant: string): VirtualReleaseModelContract => ({
  anchor: { date: '2026-09-01', sequence: '0' }, editorialStatus: 'ONGOING', exceptions: [],
  explicitNext: releaseEvent(id, instant), intervalDays: 7, provider: 'anilist', providerWorkId: '42',
  provenance: { observedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' },
  releaseKind: 'episode', revision: `${workId}-revision`, validity: sourceWindow, workId,
});
const sourceWindow = { from: '2026-09-01', to: '2026-10-01' };

describe('HttpPublicReleaseLoader', () => {
  it('stores a published empty window and reuses it without another provider or HTTP request', async () => {
    const window = { from: '2026-09-12', to: '2026-09-28' };
    const generation = { etag: '"calendar-verified-empty"', events: [], generatedAt: '2026-09-12T00:00:00.000Z', revision: 'calendar-verified-empty', source: 'shared' as const, window };
    const cache = { load: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(generation), save: vi.fn() };
    const fetcher = vi.fn(async () => Response.json({ models: [], generatedAt: generation.generatedAt, revision: generation.revision, window }, { headers: { ETag: generation.etag } }));
    const loader = new HttpPublicReleaseLoader('https://tobirink.com', fetcher, () => Date.parse('2026-09-12T01:00:00.000Z'));
    expect((await loader.load(cache, window)).snapshot.events).toEqual([]);
    expect(cache.save).toHaveBeenCalledWith(generation);
    expect((await loader.load(cache, window)).source).toBe('cache');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['fallback', 'different-window', 'missing'] as const)('rejects a 304 for a %s cache without sending its ETag', async (kind) => {
    const window = { from: '2026-09-12', to: '2026-09-28' };
    const snapshot = { etag: '"other-generation"', events: [], generatedAt: '2026-09-10T00:00:00.000Z', revision: 'other-generation', source: kind === 'fallback' ? 'fallback' as const : 'shared' as const, window: kind === 'different-window' ? { from: '2026-09-01', to: '2026-09-10' } : window };
    const cache = { load: async () => kind === 'missing' ? undefined : snapshot, save: vi.fn() };
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return new Response(null, { status: 304 });
    });
    await expect(new HttpPublicReleaseLoader('https://tobirink.com', fetcher).load(cache, window)).rejects.toThrow('public-release-unexpected-304');
    expect(cache.save).not.toHaveBeenCalled();
  });

  it('keeps the last good cache on 304 and avoids a write', async () => {
    const snapshot = { etag: '"release-r1-window"', events: [], generatedAt: '2026-09-10T00:00:00.000Z', revision: 'r1', source: 'shared' as const, window: { from: '2026-09-01', to: '2026-10-01' } };
    const cache = { load: async () => snapshot, save: vi.fn() };
    const loader = new HttpPublicReleaseLoader('https://tobirink.com', async (_input, init) => { expect(init?.headers).toEqual({ 'If-None-Match': snapshot.etag }); return new Response(null, { status: 304 }); }, () => Date.parse('2026-09-12T00:00:00.000Z'));
    expect((await loader.load(cache, snapshot.window)).source).toBe('cache'); expect(cache.save).not.toHaveBeenCalled();
  });

  it('uses a valid last-good shared generation when D1 is temporarily unavailable', async () => {
    const snapshot = { etag: '"release-r1-window"', events: [releaseEvent('anilist-episode-42-1', '2026-09-13T00:00:00.000Z')], generatedAt: '2026-09-10T00:00:00.000Z', revision: 'r1', source: 'shared' as const, window: sourceWindow };
    const cache = { load: async () => snapshot, save: vi.fn() };
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const loader = new HttpPublicReleaseLoader('https://tobirink.com', fetcher, () => Date.parse('2026-09-12T00:00:00.000Z'));
    await expect(loader.load(cache, sourceWindow)).resolves.toEqual({ snapshot, source: 'cache' });
    expect(cache.save).not.toHaveBeenCalled();
  });

  it('follows every cursor and commits only the complete generation', async () => {
    const responses = [
      Response.json({ models: [releaseModel('work-1', 'anilist-episode-42-1', '2026-09-13T00:00:00.000Z')], generatedAt: '2026-09-12T00:00:00.000Z', nextCursor: 'work-1', revision: 'models-1-2', window: sourceWindow }, { headers: { ETag: '"release-models-1-window"' } }),
      Response.json({ models: [releaseModel('work-2', 'anilist-episode-42-2', '2026-09-20T00:00:00.000Z')], generatedAt: '2026-09-12T00:00:00.000Z', revision: 'models-1-2', window: sourceWindow }, { headers: { ETag: '"release-models-1-window"' } }),
    ];
    const cache = { load: async () => undefined, save: vi.fn() };
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => responses.shift()!);
    const result = await new HttpPublicReleaseLoader('https://tobirink.com', fetcher).load(cache, { from: '2026-09-01', to: '2026-10-01' });
    expect(result.snapshot.events).toHaveLength(2);
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain('cursor=work-1');
    expect(cache.save).toHaveBeenCalledTimes(1);
  });

  it('keeps the active generation when a later page fails', async () => {
    const first = Response.json({ models: [releaseModel('work-1', 'anilist-episode-42-1', '2026-09-13T00:00:00.000Z')], generatedAt: '2026-09-12T00:00:00.000Z', nextCursor: 'work-1', revision: 'models-1-2', window: sourceWindow }, { headers: { ETag: '"release-models-1-window"' } });
    const cache = { load: async () => undefined, save: vi.fn() };
    const fetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(new HttpPublicReleaseLoader('https://tobirink.com', fetcher).load(cache, { from: '2026-09-01', to: '2026-10-01' })).rejects.toThrow('public-release-http-503');
    expect(cache.save).not.toHaveBeenCalled();
  });

  it('does not replace the active generation with an empty shared result', async () => {
    const response = Response.json({ models: [], generatedAt: '2026-09-12T00:00:00.000Z', revision: 'models-0-0', window: sourceWindow }, { headers: { ETag: '"release-models-empty-window"' } });
    const cache = { load: async () => undefined, save: vi.fn() };
    await expect(new HttpPublicReleaseLoader('https://tobirink.com', async () => response).load(cache, { from: '2026-09-01', to: '2026-10-01' })).rejects.toThrow('public-release-generation-empty');
    expect(cache.save).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'stale', generatedAt: '2026-09-03T23:59:59.999Z', window: sourceWindow, error: 'public-release-generation-stale' },
    { name: 'outside source window', generatedAt: '2026-09-10T00:00:00.000Z', window: { from: '2026-09-10', to: '2026-09-20' }, error: 'public-release-generation-window-mismatch' },
  ])('rejects a $name generation without replacing the cache', async ({ generatedAt, window: publishedWindow, error }) => {
    const cache = { load: async () => undefined, save: vi.fn() };
    const response = Response.json({ models: [], generatedAt, revision: 'models-old', window: publishedWindow }, { headers: { ETag: '"models-old"' } });
    const loader = new HttpPublicReleaseLoader('https://tobirink.com', async () => response, () => Date.parse('2026-09-12T00:00:00.000Z'));
    await expect(loader.load(cache, sourceWindow)).rejects.toThrow(error);
    expect(cache.save).not.toHaveBeenCalled();
  });

  it('always requests models and projects them inside the extension', async () => {
    const cache = { load: async () => undefined, save: vi.fn() };
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ models: [releaseModel('work-1', 'anilist-episode-42-1', '2026-09-13T00:00:00.000Z')], generatedAt: '2026-09-12T00:00:00.000Z', revision: 'models-1-1', window: sourceWindow }, { headers: { ETag: '"models-1"' } }));
    await new HttpPublicReleaseLoader('https://tobirink.com', fetcher, () => Date.parse('2026-09-12T01:00:00.000Z')).load(cache, sourceWindow);
    expect(fetcher.mock.calls[0]?.[0].toString()).toContain('/v4/release-models?');
  });
});
