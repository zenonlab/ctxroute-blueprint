import { createFavoriteObservation } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { favoriteArtifactAliasKeys } from './local-favorite-identity';
import { parseFavoriteObservation } from './favorite-parser';
import { extractFavoriteSourceEvidence } from './source-evidence';

describe('learned favorite aliases', () => {
  it('does not learn an unrelated bookmark label merely because its URL resolved', () => {
    const input = { sourceKey: 'alias-fixture', title: 'Watch later', url: 'https://fixtures.tobirink.invalid/anime/frieren' };
    const observation = createFavoriteObservation({ bookmarkId: input.sourceKey, folderPath: [], observationRevision: 'fixture-v1', observationSequence: 1, observedAt: '2026-09-08T00:00:00.000Z', presence: 'observed', siblingOrder: 0, title: input.title, url: input.url });
    const artifact = parseFavoriteObservation(observation, extractFavoriteSourceEvidence(input));
    const candidate = { externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] };
    expect(favoriteArtifactAliasKeys(artifact, candidate)).toEqual(['["ANIME",null,"frieren"]']);
  });
});
