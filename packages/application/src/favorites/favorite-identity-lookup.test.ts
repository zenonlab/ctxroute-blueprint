import { createFavoriteObservation } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { favoriteIdentityKey, favoriteIdentityKeySchema, favoriteIdentityLookupResultSchema, favoriteManualIdentityKey, resolveSynchronizedFavoriteIdentity } from './favorite-identity-lookup';
import { parseFavoriteObservation } from './favorite-parser';
import { extractFavoriteSourceEvidence } from './source-evidence';

const input = { sourceKey: 'identity-fixture', title: 'Synthetic Series', url: 'https://fixtures.tobirink.invalid/anime/synthetic-series' };
const observation = createFavoriteObservation({ bookmarkId: input.sourceKey, folderPath: ['Private folder'], observationRevision: 'fixture-v1', observationSequence: 1, observedAt: '2026-09-08T00:00:00.000Z', presence: 'observed', siblingOrder: 0, title: input.title, url: input.url });
const artifact = parseFavoriteObservation(observation, extractFavoriteSourceEvidence(input));
const candidate = { provider: 'anilist' as const, externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, titles: ['Synthetic Series'] };
const unused = { hydrate: async () => { throw new Error('unrouted provider'); } };
const hydration = { anilist: { hydrate: async () => candidate }, mangaupdates: unused, mangadex: unused, 'kitsu-anime': unused, 'kitsu-manga': unused };

describe('synchronized favorite identity lookup', () => {
  it('hashes identity, type and season without private source fields', async () => {
    const key = await favoriteIdentityKey(artifact);
    expect(key).toEqual({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u), mediaKind: 'ANIME', parserVersion: artifact.parserVersion, siteRulesVersion: artifact.sourceAdapterVersion });
    expect(await favoriteIdentityKey({ ...artifact, raw: { title: 'Private rename', url: 'https://example.invalid/private' } })).toEqual(key);
    expect((await favoriteIdentityKey({ ...artifact, season: 2 })).fingerprint).not.toBe(key.fingerprint);
    expect(() => favoriteIdentityKeySchema.parse({ ...key, title: input.title })).toThrow();
  });

  it('uses a distinct stable key for each explicit manual provider identity', async () => {
    const titleKey = await favoriteIdentityKey(artifact);
    const manual = await favoriteManualIdentityKey(artifact, { externalId: '1', provider: 'anilist' });
    expect(manual).toMatchObject({ mediaKind: artifact.mediaKind, parserVersion: artifact.parserVersion, siteRulesVersion: artifact.sourceAdapterVersion });
    expect(manual.fingerprint).not.toBe(titleKey.fingerprint);
    expect(await favoriteManualIdentityKey({ ...artifact, raw: { title: 'Private rename', url: 'https://private.invalid/value' } }, { externalId: '1', provider: 'anilist' })).toEqual(manual);
    expect((await favoriteManualIdentityKey(artifact, { externalId: '2', provider: 'anilist' })).fingerprint).not.toBe(manual.fingerprint);
  });

  it('hydrates one synchronized identity by provider priority', async () => {
    const key = await favoriteIdentityKey(artifact);
    const references = [{ provider: 'kitsu-anime' as const, externalId: '2' }, { provider: 'anilist' as const, externalId: '1' }];
    await expect(resolveSynchronizedFavoriteIdentity({ lookup: async () => [{ fingerprint: key.fingerprint, kind: 'FOUND', mediaKind: 'ANIME', references }] }, artifact, hydration))
      .resolves.toEqual({ kind: 'RESOLVED', candidate, references });
  });

  it('reconstructs synchronized ambiguity as comparable candidates', async () => {
    const key = await favoriteIdentityKey(artifact);
    const second = { canonicalUrl: 'https://kitsu.app/anime/2', provider: 'kitsu-anime' as const, externalId: '2', mediaKind: 'ANIME' as const, preSerialization: false, titles: ['Synthetic Series'] };
    const first = { ...candidate, canonicalUrl: 'https://anilist.co/anime/1' };
    const result = await resolveSynchronizedFavoriteIdentity({ lookup: async () => [{ fingerprint: key.fingerprint, identities: [
      { mediaKind: 'ANIME', references: [{ provider: 'anilist', externalId: '1' }] },
      { mediaKind: 'ANIME', references: [{ provider: 'kitsu-anime', externalId: '2' }] },
    ], kind: 'AMBIGUOUS' }] }, artifact, hydration, async (reference) => reference.provider === 'anilist' ? first : second);
    expect(result).toEqual({ candidates: [first, second], kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' });
  });

  it('rejects unrelated, incomplete and duplicate-provider results', async () => {
    expect(await resolveSynchronizedFavoriteIdentity({ lookup: async () => [] }, artifact, hydration)).toEqual({ kind: 'RETRYABLE', stage: 'LOOKUP' });
    expect(await resolveSynchronizedFavoriteIdentity({ lookup: async () => [{ fingerprint: 'a'.repeat(64), kind: 'MISS' }] }, artifact, hydration)).toEqual({ kind: 'RETRYABLE', stage: 'LOOKUP' });
    expect(() => favoriteIdentityLookupResultSchema.parse({ fingerprint: 'a'.repeat(64), kind: 'FOUND', mediaKind: 'ANIME', references: [{ provider: 'anilist', externalId: '1' }, { provider: 'anilist', externalId: '2' }] })).toThrow();
  });

  it('keeps failed sync retryable and absent sync optional', async () => {
    expect(await resolveSynchronizedFavoriteIdentity({ lookup: async () => { throw new Error('offline'); } }, artifact, hydration)).toEqual({ kind: 'RETRYABLE', stage: 'LOOKUP' });
    expect(await resolveSynchronizedFavoriteIdentity(undefined, artifact, hydration)).toEqual({ kind: 'MISS' });
  });
});
