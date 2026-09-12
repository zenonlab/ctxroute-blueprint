import { createFavoriteObservation } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { parseFavoriteObservation } from '../favorites/favorite-parser';
import { extractFavoriteSourceEvidence } from '../favorites/source-evidence';
import { favoriteCollectiveKey, favoriteCollectiveKeySchema, favoriteCollectiveLookupQuerySchema, favoriteCollectiveLookupResultSchema, resolveFavoriteCollectiveIdentity } from './favorite-collective-lookup';

const input = { sourceKey: 'collective-fixture', title: 'Synthetic Series', url: 'https://fixtures.tobirink.invalid/anime/synthetic-series' };
const observation = createFavoriteObservation({ bookmarkId: input.sourceKey, folderPath: ['Private folder'], observationRevision: 'fixture-v1', observationSequence: 1, observedAt: '2026-09-08T00:00:00.000Z', presence: 'observed', siblingOrder: 0, title: input.title, url: input.url });
const artifact = parseFavoriteObservation(observation, extractFavoriteSourceEvidence(input));
const candidate = { provider: 'anilist' as const, externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, titles: ['Synthetic Series'] };
const unused = { hydrate: async () => { throw new Error('unrouted provider'); } };
const hydration = { anilist: { hydrate: async () => candidate }, mangaupdates: unused, mangadex: unused, 'kitsu-anime': unused, 'kitsu-manga': unused };

describe('minimal collective lookup boundary', () => {
  it('allows only an owner preference to settle a local ambiguity', async () => {
    const key = await favoriteCollectiveKey(artifact);
    const references = [{ provider: 'anilist' as const, externalId: '1' }];
    const port = { lookup: async () => [{ fingerprint: key.fingerprint, kind: 'FOUND' as const, scope: 'shared' as const, mediaKind: 'ANIME' as const, references }] };
    expect(await resolveFavoriteCollectiveIdentity(port, artifact, hydration, true)).toEqual({ kind: 'MISS' });
    expect(await resolveFavoriteCollectiveIdentity(port, artifact, hydration)).toMatchObject({ kind: 'RESOLVED', scope: 'shared' });
  });
  it('hashes title, type and season without sending private fields', async () => {
    const key = await favoriteCollectiveKey(artifact);
    expect(key).toEqual({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u), mediaKind: 'ANIME', parserVersion: artifact.parserVersion, siteRulesVersion: artifact.sourceAdapterVersion });
    expect(await favoriteCollectiveKey({ ...artifact, raw: { title: 'Private rename', url: 'https://example.invalid/private' } })).toEqual(key);
    expect((await favoriteCollectiveKey({ ...artifact, season: 2 })).fingerprint).not.toBe(key.fingerprint);
    expect((await favoriteCollectiveKey({ ...artifact, mediaKind: 'MANGA' })).fingerprint).not.toBe(key.fingerprint);
    expect(() => favoriteCollectiveKeySchema.parse({ ...key, title: input.title })).toThrow();
    expect(() => favoriteCollectiveLookupQuerySchema.parse(Array.from({ length: 51 }, () => key))).toThrow();
  });

  it('hydrates a confirmed identity by provider priority independent of reference order', async () => {
    const key = await favoriteCollectiveKey(artifact);
    const references = [{ provider: 'kitsu-anime' as const, externalId: '2' }, { provider: 'anilist' as const, externalId: '1' }];
    const result = await resolveFavoriteCollectiveIdentity({ lookup: async () => [{ fingerprint: key.fingerprint, kind: 'FOUND', scope: 'owner', mediaKind: 'ANIME', references }] }, artifact, hydration);
    expect(result).toEqual({ kind: 'RESOLVED', candidate, references, scope: 'owner' });
  });

  it('rejects unrelated keys and incomplete batch responses', async () => {
    expect(await resolveFavoriteCollectiveIdentity({ lookup: async () => [] }, artifact, hydration)).toEqual({ kind: 'RETRYABLE', stage: 'LOOKUP' });
    expect(await resolveFavoriteCollectiveIdentity({ lookup: async () => [{ fingerprint: 'a'.repeat(64), kind: 'MISS' }] }, artifact, hydration)).toEqual({ kind: 'RETRYABLE', stage: 'LOOKUP' });
  });

  it('rejects two different IDs from one provider presented as one identity', () => {
    expect(() => favoriteCollectiveLookupResultSchema.parse({ fingerprint: 'a'.repeat(64), kind: 'FOUND', scope: 'owner', mediaKind: 'ANIME', references: [{ provider: 'anilist', externalId: '1' }, { provider: 'anilist', externalId: '2' }] })).toThrow();
  });

  it('keeps a failed lookup retryable while a disabled collective remains optional', async () => {
    expect(await resolveFavoriteCollectiveIdentity({ lookup: async () => { throw new Error('offline'); } }, artifact, hydration)).toEqual({ kind: 'RETRYABLE', stage: 'LOOKUP' });
    expect(await resolveFavoriteCollectiveIdentity(undefined, artifact, hydration)).toEqual({ kind: 'MISS' });
  });
});
