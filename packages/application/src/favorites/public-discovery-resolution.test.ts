import { createFavoriteObservation } from '@tobirink/domain';
import { describe, expect, it, vi } from 'vitest';
import { favoriteIdentityKey, favoriteManualIdentityKey } from './favorite-identity-lookup';
import { parseFavoriteObservation } from './favorite-parser';
import { requestPublicFavoriteDiscovery, requestPublicFavoriteDiscoveryRecovery } from './public-discovery-resolution';
import { extractFavoriteSourceEvidence } from './source-evidence';

const input = { sourceKey: 'manual-discovery', title: 'Synthetic Series', url: 'https://reader.invalid/anime/synthetic-series' };
const observation = createFavoriteObservation({ bookmarkId: input.sourceKey, folderPath: [], observationRevision: 'fixture-v1', observationSequence: 1, observedAt: '2026-09-15T00:00:00.000Z', presence: 'observed', siblingOrder: 0, title: input.title, url: input.url });
const artifact = parseFavoriteObservation(observation, extractFavoriteSourceEvidence(input));

describe('public favorite discovery request', () => {
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
