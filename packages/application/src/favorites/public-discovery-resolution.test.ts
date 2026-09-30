import { createFavoriteObservation } from '@tobirink/domain';
import { describe, expect, it, vi } from 'vitest';
import { favoriteIdentityKey, favoriteManualIdentityKey } from './favorite-identity-lookup';
import { parseFavoriteObservation } from './favorite-parser';
import { preparePublicFavoriteDiscoveryIdentity, requestPublicFavoriteDiscovery, requestPublicFavoriteDiscoveryRecovery } from './public-discovery-resolution';
import { extractFavoriteSourceEvidence } from './source-evidence';

const input = { sourceKey: 'manual-discovery', title: 'Synthetic Series', url: 'https://reader.invalid/anime/synthetic-series' };
const observation = createFavoriteObservation({ bookmarkId: input.sourceKey, folderPath: [], observationRevision: 'fixture-v1', observationSequence: 1, observedAt: '2026-09-15T00:00:00.000Z', presence: 'observed', siblingOrder: 0, title: input.title, url: input.url });
const artifact = parseFavoriteObservation(observation, extractFavoriteSourceEvidence(input));

describe('public favorite discovery request', () => {
  it.each(['ANIME', 'MANGA', 'MANHWA', 'MANHUA'] as const)('reuses one synchronized %s identity with multiple provider references', async (mediaKind) => {
    const parsed = { ...artifact, mediaKind };
    const key = await favoriteIdentityKey(parsed);
    const primary = mediaKind === 'ANIME'
      ? { provider: 'anilist' as const, externalId: '123' }
      : { provider: 'mangaupdates' as const, externalId: '456' };
    const secondary = mediaKind === 'ANIME'
      ? { provider: 'kitsu-anime' as const, externalId: '789' }
      : { provider: 'anilist' as const, externalId: '123' };
    for (const references of [[secondary, primary], [primary, secondary]]) {
      const lookup = async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind, references }];
      const prepared = await preparePublicFavoriteDiscoveryIdentity(parsed, { lookup });
      expect(prepared).toEqual({ key: await favoriteManualIdentityKey(parsed, primary), reference: primary });
      const resolveOrRequest = vi.fn(async () => ({ state: 'MISS' as const }));
      const requestRecovery = vi.fn(async () => ({ state: 'MISS' as const }));
      const port = { resolveOrRequest, requestRecovery };
      const options = { explicitProviderReference: prepared.reference! };
      await requestPublicFavoriteDiscovery(port, prepared.key, parsed, options);
      await requestPublicFavoriteDiscoveryRecovery(port, prepared.key, parsed, options);
      expect(resolveOrRequest).toHaveBeenCalledExactlyOnceWith(prepared.key, expect.objectContaining({ explicitProviderReference: primary }));
      expect(requestRecovery.mock.calls).toEqual(resolveOrRequest.mock.calls);
    }
  });

  it.each(['MANGA', 'MANHWA', 'MANHUA'] as const)('reuses a typed compatible sync hint for a %s source without changing its key contract', async (mediaKind) => {
    const comic = { ...artifact, mediaKind };
    const key = await favoriteIdentityKey(comic);
    const reference = { provider: 'mangaupdates' as const, externalId: '123' };
    const lookup = vi.fn(async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'MANHWA' as const, references: [reference] }]);
    await expect(preparePublicFavoriteDiscoveryIdentity(comic, { lookup })).resolves.toEqual({ key: await favoriteManualIdentityKey(comic, reference), reference });
    expect(await favoriteIdentityKey(comic)).toEqual(key);
  });

  it('rejects a synchronized anime identity carrying a manga-only provider', async () => {
    const key = await favoriteIdentityKey(artifact);
    const lookup = async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'ANIME' as const, references: [{ provider: 'mangaupdates' as const, externalId: '123' }] }];
    await expect(preparePublicFavoriteDiscoveryIdentity(artifact, { lookup })).resolves.toEqual({ key, reference: undefined });
  });

  it('ignores malformed synchronized identity envelopes', async () => {
    const key = await favoriteIdentityKey(artifact);
    const lookup = async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: '123' }], unexpected: true }];
    await expect(preparePublicFavoriteDiscoveryIdentity(artifact, { lookup })).resolves.toEqual({ key, reference: undefined });
  });

  it('uses a typed UNKNOWN hint but never replaces an explicit source reference', async () => {
    const unknown = { ...artifact, mediaKind: 'UNKNOWN' as const };
    const key = await favoriteIdentityKey(unknown);
    const reference = { provider: 'mangaupdates' as const, externalId: '123' };
    const lookup = vi.fn(async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'MANHWA' as const, references: [reference] }]);
    await expect(preparePublicFavoriteDiscoveryIdentity(unknown, { lookup })).resolves.toEqual({ key: await favoriteManualIdentityKey(unknown, reference), reference });
    const explicit = { provider: 'anilist' as const, externalId: '42' };
    lookup.mockClear();
    await expect(preparePublicFavoriteDiscoveryIdentity({ ...unknown, sourceEvidence: { ...unknown.sourceEvidence, explicitProviderReference: explicit } }, { lookup }))
      .resolves.toEqual({ key: await favoriteManualIdentityKey(unknown, explicit), reference: explicit });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('shares exact-reference and synchronized-hint keys with the normal request', async () => {
    const reference = { externalId: '123', provider: 'anilist' as const };
    const exactArtifact = { ...artifact, sourceEvidence: { ...artifact.sourceEvidence, explicitProviderReference: reference } };
    const expected = { key: await favoriteManualIdentityKey(artifact, reference), reference };
    await expect(preparePublicFavoriteDiscoveryIdentity(exactArtifact)).resolves.toEqual(expected);
    const lookup = vi.fn(async () => [{ kind: 'FOUND' as const, fingerprint: (await favoriteIdentityKey(artifact)).fingerprint, mediaKind: 'ANIME' as const, references: [reference] }]);
    const hint = await preparePublicFavoriteDiscoveryIdentity(artifact, { lookup });
    expect(hint).toEqual(expected);
    const resolveOrRequest = vi.fn(async () => ({ state: 'UNAVAILABLE' as const, reason: 'ATTEMPT_LIMIT' as const }));
    const requestRecovery = vi.fn(async () => ({ state: 'PENDING' as const, retryAt: '2026-09-15T00:10:00.000Z' }));
    await requestPublicFavoriteDiscovery({ resolveOrRequest }, hint.key, artifact, { explicitProviderReference: hint.reference });
    await requestPublicFavoriteDiscoveryRecovery({ resolveOrRequest, requestRecovery }, hint.key, artifact, { explicitProviderReference: hint.reference });
    expect(requestRecovery.mock.calls).toEqual(resolveOrRequest.mock.calls);
  });

  it('ignores unavailable, mismatched and ambiguous synchronized hints', async () => {
    const key = await favoriteIdentityKey(artifact);
    for (const lookup of [
      async () => { throw new Error('offline'); },
      async () => [{ kind: 'FOUND' as const, fingerprint: 'f'.repeat(64), mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: '123' }] }],
      async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'MANGA' as const, references: [{ provider: 'mangaupdates' as const, externalId: '123' }] }],
      async () => [{ kind: 'AMBIGUOUS' as const, fingerprint: key.fingerprint, identities: [
        { mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: '123' }] },
        { mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: '456' }] },
      ] }],
      async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: '123' }, { provider: 'anilist' as const, externalId: '456' }] }],
      async () => [{ kind: 'FOUND' as const, fingerprint: key.fingerprint, mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: '123' }, { provider: 'mangaupdates' as const, externalId: '456' }] }],
    ]) await expect(preparePublicFavoriteDiscoveryIdentity(artifact, { lookup })).resolves.toEqual({ key, reference: undefined });
  });

  it('sends a bounded explicit provider reference under its dedicated key', async () => {
    const resolveOrRequest = vi.fn(async () => ({ retryAt: '2026-09-15T00:10:00.000Z', state: 'PENDING' as const }));
    const reference = { externalId: '123', provider: 'anilist' as const };
    const key = await favoriteManualIdentityKey(artifact, reference);
    await expect(requestPublicFavoriteDiscovery({ resolveOrRequest }, key, artifact, { explicitProviderReference: reference })).resolves.toMatchObject({ state: 'PENDING' });
    expect(resolveOrRequest).toHaveBeenCalledExactlyOnceWith(key, expect.objectContaining({
      discoveryTitles: ['synthetic series', 'syntheticseries'],
      explicitProviderReference: reference,
      sourceTitles: ['synthetic series'],
    }));
  });

  it('uses the explicit recovery port without changing the canonical query', async () => {
    const requestRecovery = vi.fn(async () => ({ retryAt: '2026-09-15T00:10:00.000Z', state: 'PENDING' as const }));
    const key = await favoriteIdentityKey(artifact);
    await expect(requestPublicFavoriteDiscoveryRecovery({ resolveOrRequest: vi.fn(), requestRecovery }, key, artifact)).resolves.toMatchObject({ state: 'PENDING' });
    expect(requestRecovery).toHaveBeenCalledExactlyOnceWith(key, expect.objectContaining({
      discoveryTitles: ['synthetic series', 'syntheticseries'],
      sourceTitles: ['synthetic series'],
    }));
  });
});
