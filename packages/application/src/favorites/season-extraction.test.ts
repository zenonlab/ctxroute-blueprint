import { createSourceEvidence } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { extractFavoriteSeason } from './season-extraction';

const evidence = (values = {}) => createSourceEvidence({ aliases: [], diagnostics: [], key: 'season', mediaKind: 'ANIME', proofs: [], sourceAdapter: 'fixture', strategy: 'generic', ...values });

describe('favorite season extraction S-01…S-07', () => {
  it.each(['Frieren S4', 'Frieren Season 4', 'Frieren Saison-4', 'Frieren temporada_4'])('S-01 extracts a labelled season from %s', (title) => expect(extractFavoriteSeason(title, evidence()).canonicalSeason).toBe(4));
  it('S-02 extracts an ordinal season', () => expect(extractFavoriteSeason('Frieren 4th Season', evidence()).canonicalSeason).toBe(4));
  it('S-03 keeps a bare final number as provenance only', () => expect(extractFavoriteSeason('Frieren 4', evidence())).toEqual({ bareTrailingNumber: 4, conflict: false }));
  it('S-04 extracts a compact URL season', () => expect(extractFavoriteSeason('Frieren', evidence({ path: '/anime/frieren/season4' })).urlSeason).toBe(4));
  it('S-05 merges equal title and URL seasons', () => expect(extractFavoriteSeason('Frieren S4', evidence({ season: 4 }))).toMatchObject({ canonicalSeason: 4, conflict: false }));
  it('S-06 fails closed on conflicting seasons', () => expect(extractFavoriteSeason('Frieren S4', evidence({ season: 3 }))).toEqual({ conflict: true, titleSeason: 4, urlSeason: 3 }));
  it('S-07 does not create progression from a season', () => expect(extractFavoriteSeason('Frieren S4', evidence())).not.toHaveProperty('bareTrailingNumber'));
});
