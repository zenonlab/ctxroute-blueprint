import { describe, expect, it } from 'vitest';
import { segmentFavoriteTitle } from './title-segmentation';

describe('favorite title segmentation T-01…T-10', () => {
  it('T-01 removes a reader prefix', () => expect(segmentFavoriteTitle('Read: Frieren').cleanedTitle).toBe('Frieren'));
  it('T-02 removes an initial OVA badge only with track proof', () => { expect(segmentFavoriteTitle('(OVA VOSTFR) Frieren').cleanedTitle).toBe('Frieren'); expect(segmentFavoriteTitle('(OVA) Frieren').cleanedTitle).toBe('(OVA) Frieren'); });
  it('T-03 separates a labelled release', () => expect(segmentFavoriteTitle('Frieren chapitre 12').releases).toMatchObject([{ kind: 'chapter', value: 12 }]));
  it('T-04 separates a number followed by a track', () => expect(segmentFavoriteTitle('Frieren 7 VOSTFR')).toMatchObject({ cleanedTitle: 'Frieren', releases: [{ proof: 'separated-release', value: 7 }] }));
  it('T-05 removes only a closed marketing suffix', () => expect(segmentFavoriteTitle('Frieren online free').cleanedTitle).toBe('Frieren'));
  it('T-06 removes an observed hostname segment', () => expect(segmentFavoriteTitle('Frieren | example', 'example.test').cleanedTitle).toBe('Frieren'));
  it('T-07 deduplicates equal human segments', () => expect(segmentFavoriteTitle('Frieren | frieren')).toMatchObject({ cleanedTitle: 'Frieren', transformations: ['repeated-human-title'] }));
  it('T-08 preserves an unproven track word', () => expect(segmentFavoriteTitle('Sub Hero Academy').cleanedTitle).toBe('Sub Hero Academy'));
  it('T-09 preserves display punctuation', () => expect(segmentFavoriteTitle('Frieren: Beyond!').cleanedTitle).toBe('Frieren: Beyond!'));
  it('T-10 records a terminal year without making progress', () => expect(segmentFavoriteTitle('Pluto (2023)')).toMatchObject({ releases: [], year: 2023 }));
});
