import { createSourceEvidence } from '@tobirink/domain';
import type { FavoriteMediaKind } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { extractFavoriteProgression } from './progression-extraction';
import { extractFavoriteSeason } from './season-extraction';
import { segmentFavoriteTitle } from './title-segmentation';

function progress(title: string, values = {}, mediaKind: FavoriteMediaKind = 'MANGA', aliases: readonly string[] = ['Frieren']) {
  const evidence = createSourceEvidence({ aliases: [], diagnostics: [], key: 'progress', mediaKind, proofs: [], sourceAdapter: 'fixture', strategy: 'generic', ...values });
  return extractFavoriteProgression({ aliases, evidence, mediaKind, season: extractFavoriteSeason(title, evidence), title, titleAnalysis: segmentFavoriteTitle(title) });
}

describe('favorite progression extraction R-01…R-14', () => {
  it('R-01 keeps an explicit integer chapter', () => expect(progress('Frieren chapitre 12')).toMatchObject({ kind: 'chapter', value: 12 }));
  it('R-02 parses a localized decimal episode', () => expect(progress('Frieren épisode 7,5', {}, 'ANIME')).toMatchObject({ kind: 'episode', value: 7.5 }));
  it('R-03 keeps a decimal URL chapter', () => expect(progress('Frieren', { release: { kind: 'chapter', provenance: 'URL_PATH', raw: '12,5', value: 12.5 } })).toMatchObject({ proof: 'labelled-url-path', value: 12.5 }));
  it('R-04 selects the last equal-quality marker', () => expect(progress('Frieren chapitre 108 puis chapitre 11')).toMatchObject({ raw: '11', value: 11 }));
  it('R-05 lets an explicit marker beat a terminal number', () => expect(progress('Frieren chapitre 8 999', {}, 'MANGA', ['Frieren chapitre 8'])).toMatchObject({ proof: 'explicit-marker', value: 8 }));
  it('R-06 rejects a year as progression', () => expect(progress('Frieren 2023')).toBeUndefined());
  it('R-07 rejects a numeric URL without source identity', () => expect(progress('Frieren', { path: '/read/12' })).toBeUndefined());
  it('R-08 accepts a numeric URL after source identity', () => expect(progress('Frieren', { path: '/read/frieren/12', stableSlug: 'frieren', title: 'Frieren' })).toMatchObject({ proof: 'numeric-url-segment-after-source-identity', value: 12 }));
  it('R-09 accepts an adjacent number after an established alias', () => expect(progress('Frieren 9')).toMatchObject({ proof: 'bare-number-after-validated-identity', value: 9 }));
  it('R-10 preserves a number intrinsic to the title', () => expect(progress('86', {}, 'ANIME', ['86'])).toBeUndefined());
  it('R-11 uses only the number after a numeric identity', () => expect(progress('86 12', {}, 'ANIME', ['86'])).toMatchObject({ value: 12 }));
  it('R-12 preserves an ordinal', () => expect(progress('Frieren 2nd')).toBeUndefined());
  it('R-13 rejects a URL number equal to a proved season', () => expect(progress('Frieren Season 2', { path: '/anime/frieren/season/2', season: 2, stableSlug: 'frieren' }, 'ANIME')).toBeUndefined());
  it('R-14 preserves local progression despite a season conflict', () => expect(progress('Frieren S4 7', { season: 3 }, 'ANIME', ['Frieren S4'])).toMatchObject({ proof: 'season-divergence', value: 7 }));
});
