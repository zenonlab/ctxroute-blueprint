import { MemoryStoragePort } from '@tobirink/contracts';
import { createFavoriteParseArtifact, createFavoriteSource, createWork, favoriteSourceId, workId } from '@tobirink/domain';
import { describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryRefreshRuntime, publicDiscoveryRefreshCheckpointKey, publicDiscoveryRefreshDue } from './public-discovery-refresh-runtime';

const now = '2026-09-16T12:00:00.000Z';

function fixture(index: number) {
  const id = workId(`work_public_${index}`);
  const source = createFavoriteSource({
    bookmarkId: `bookmark-${index}`, folderPath: [], id: favoriteSourceId(`source_public_${index}`), importedAt: now,
    matchedWorkId: id, order: index, resolution: { kind: 'RESOLVED' }, title: `Work ${index}`, url: `https://example.com/work/${index}`,
  });
  const artifact = createFavoriteParseArtifact({
    aliases: [], contractVersion: 2, diagnostics: [], displayTitle: `Work ${index}`, identityKey: `work ${index}`,
    matcherVersion: '4', mediaKind: 'ANIME', parserVersion: '5', progressionParserVersion: '2',
    raw: { title: `Work ${index}`, url: source.url }, segments: [],
    semanticFingerprint: `fixture-${index}`, sourceAdapterVersion: '3',
    sourceEvidence: { aliases: [], diagnostics: [], key: `work-${index}`, mediaKind: 'ANIME', origin: 'https://example.com', path: `/work/${index}`, proofs: ['CATEGORY_PATH'], sourceAdapter: 'test', strategy: 'exact-origin' },
    status: 'parsed', transformations: [],
  });
  const candidate = { externalId: String(index + 1), mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: [`Work ${index}`] };
  const work = createWork({
    externalReferences: [{ externalId: candidate.externalId, provider: candidate.provider }],
    hydration: { candidate, favoriteAliasKeys: [], hydratedAt: '2026-09-01T00:00:00.000Z', matcherVersion: '4', providerTitleKeys: [`work ${index}`] },
    id, mediaKind: 'anime', preferredTitle: `Work ${index}`,
  });
  return { artifact, candidate, source, work };
}

describe('public discovery refresh runtime', () => {
  it('assigns a stable refresh day within the seven-day window', () => {
    const base = { mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    const dayZero = { ...base, fingerprint: `00${'a'.repeat(62)}` };
    const daySix = { ...base, fingerprint: `06${'a'.repeat(62)}` };
    expect(publicDiscoveryRefreshDue(dayZero, now, now)).toBe(true);
    expect(publicDiscoveryRefreshDue(daySix, now, new Date(Date.parse(now) + 5 * 86_400_000).toISOString())).toBe(false);
    expect(publicDiscoveryRefreshDue(daySix, now, new Date(Date.parse(now) + 6 * 86_400_000).toISOString())).toBe(true);
  });

  it('walks 500 favorites in ten resumable batches and admits at most twenty refreshes per wake', async () => {
    const fixtures = Array.from({ length: 500 }, (_, index) => fixture(index));
    const storage = new MemoryStoragePort();
    vi.spyOn(storage, 'listFavoriteSources').mockImplementation(async ({ afterId, limit }) => {
      const start = afterId === undefined ? 0 : fixtures.findIndex(({ source }) => source.id === afterId) + 1;
      return fixtures.slice(start, start + limit).map(({ source }) => source);
    });
    vi.spyOn(storage, 'getFavoriteParseArtifacts').mockImplementation(async (ids) => ids.map((id) => {
      const found = fixtures.find(({ source }) => source.id === id);
      return found === undefined ? undefined : { artifact: found.artifact, recordedAt: now, sourceId: found.source.id };
    }));
    vi.spyOn(storage, 'getWorks').mockImplementation(async (ids) => ids.map((id) => fixtures.find(({ work }) => work.id === id)?.work));
    let lookupOffset = 0;
    const lookup = vi.fn(async (keys: readonly { fingerprint: string; mediaKind: 'ANIME'; parserVersion: string; siteRulesVersion: string }[]) => {
      const results = keys.map((key, index) => {
        const item = fixtures[lookupOffset + index];
        if (item === undefined) throw new Error('missing-fixture');
        return { key, state: { nextRefreshAt: '2026-09-02T00:00:00.000Z', profile: { candidate: item.candidate, references: [{ externalId: item.candidate.externalId, provider: 'anilist' as const }], workId: item.work.id }, state: 'VERIFIED' as const, verifiedAt: '2026-09-01T00:00:00.000Z' } };
      });
      lookupOffset += keys.length;
      return results;
    });
    const first = fixtures[0];
    if (first === undefined) throw new Error('missing-fixture');
    const requestRefresh = vi.fn(async () => ({ nextRefreshAt: '2026-09-23T00:00:00.000Z', profile: { candidate: first.candidate, references: [{ externalId: '1', provider: 'anilist' as const }], workId: first.work.id }, state: 'VERIFIED' as const, verifiedAt: now }));
    let checkpoint: { afterSourceId?: string; nextCycleAt?: string; version: 1 } | undefined;
    const run = createPublicDiscoveryRefreshRuntime({
      checkpointStorage: { get: async () => ({ [publicDiscoveryRefreshCheckpointKey]: checkpoint }), set: async (value) => { checkpoint = value[publicDiscoveryRefreshCheckpointKey]; } },
      client: { lookup, requestRefresh, resolveOrRequest: vi.fn() }, now: () => now, storage,
    });
    const results = [];
    do results.push(await run()); while (results.at(-1)?.continuationRequired);
    expect(lookup).toHaveBeenCalledTimes(10);
    expect(lookup.mock.calls.every(([keys]) => keys.length === 50)).toBe(true);
    expect(results).toHaveLength(11);
    expect(results.at(-1)).toMatchObject({ continuationRequired: false, inspected: 0 });
    expect(results.every(({ refreshed }) => refreshed <= 20)).toBe(true);
    expect(requestRefresh).toHaveBeenCalledTimes(200);
  });

  it('does not rewrite a fresh unchanged local profile', async () => {
    const item = fixture(0);
    const key = { fingerprint: '00'.repeat(32), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    const state = { nextRefreshAt: '2026-09-23T00:00:00.000Z', profile: { candidate: item.candidate, references: [{ externalId: '1', provider: 'anilist' as const }], workId: item.work.id }, state: 'VERIFIED' as const, verifiedAt: now };
    item.work = createWork({ ...item.work, hydration: { ...item.work.hydration!, publicDiscovery: { ...key, nextRefreshAt: state.nextRefreshAt, verifiedAt: state.verifiedAt } } });
    const storage = new MemoryStoragePort();
    vi.spyOn(storage, 'listFavoriteSources').mockResolvedValue([item.source]);
    vi.spyOn(storage, 'getFavoriteParseArtifacts').mockResolvedValue([{ artifact: item.artifact, recordedAt: now, sourceId: item.source.id }]);
    vi.spyOn(storage, 'getWorks').mockResolvedValue([item.work]);
    const putWork = vi.spyOn(storage, 'putWork');
    const requestRefresh = vi.fn();
    const run = createPublicDiscoveryRefreshRuntime({
      checkpointStorage: { get: async () => ({}), set: async () => undefined },
      client: { lookup: async (keys) => [{ key: keys[0]!, state }], requestRefresh, resolveOrRequest: vi.fn() }, now: () => now, storage,
    });
    await expect(run()).resolves.toMatchObject({ continuationRequired: false, refreshed: 0, updated: 0 });
    expect(putWork).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
  });
});
