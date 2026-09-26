import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { FavoriteProvider, ProviderCandidate, ProviderCandidateEnvelope } from '@tobirink/domain';
import { inspectFavoriteTitleCandidates as inspectPublicCandidates } from '@tobirink/public-discovery';
import { describe, expect, it } from 'vitest';
import { hasExactBlockedProviderTaxonomy, inspectFavoriteTitleCandidates, isProviderCandidateCompatible, matchFavoriteTitles } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';

function candidate(externalId: string, title: string, provider: FavoriteProvider = 'anilist'): ProviderCandidate {
  return { externalId, mediaKind: provider === 'anilist' ? 'ANIME' : 'MANGA', preSerialization: false, provider, titles: [title] };
}

function envelope(candidates: readonly ProviderCandidate[], provider: FavoriteProvider = 'anilist'): ProviderCandidateEnvelope {
  return createProviderCandidateEnvelope({ candidates, complete: true, digest: `digest-${provider}`, provider, truncated: false });
}

describe('deterministic favorite title matcher P-01…P-08', () => {
  it.each(['MANGA', 'MANHWA', 'MANHUA'] as const)('reuses every hydrated comic subtype for a %s source', (mediaKind) => {
    for (const candidateKind of ['MANGA', 'MANHWA', 'MANHUA'] as const) {
      const comic = { ...candidate('comic', 'Synthetic Comic', 'mangadex'), mediaKind: candidateKind };
      expect(isProviderCandidateCompatible({ mediaKind, sourceTitles: ['Synthetic Comic'] }, comic)).toBe(true);
      expect(matchFavoriteTitles({ mediaKind, sourceTitles: ['Synthetic Comic'] }, [envelope([comic], 'mangadex')])).toMatchObject({ kind: 'MATCH' });
      expect(isProviderCandidateCompatible({ mediaKind: 'ANIME', sourceTitles: ['Synthetic Comic'] }, comic)).toBe(false);
      expect(isProviderCandidateCompatible({ mediaKind, sourceTitles: ['Synthetic Comic'] }, candidate('anime', 'Synthetic Comic'))).toBe(false);
    }
  });

  it('keeps local and public candidate eligibility aligned for media, season and format', () => {
    const cases: readonly [FavoriteTitleMatchQuery, ProviderCandidate][] = [
      [{ mediaKind: 'MANHWA', sourceTitles: ['Target'] }, { ...candidate('42', 'Target', 'mangadex'), mediaKind: 'MANGA' }],
      [{ mediaKind: 'ANIME', sourceTitles: ['Target'] }, candidate('42', 'Target', 'mangadex')],
      [{ sourceFormat: 'NON_OVA', sourceTitles: ['Target'] }, { ...candidate('42', 'Target'), format: 'OVA' }],
      [{ preSerialization: false, sourceTitles: ['Target'] }, { ...candidate('42', 'Target'), preSerialization: true }],
      [{ explicitSeason: 2, sourceTitles: ['Target'] }, { ...candidate('42', 'Target'), season: 1 }],
      [{ explicitSeason: 2, sourceTitles: ['Target'] }, { ...candidate('42', 'Target'), season: 2 }],
      [{ explicitSeason: 2, sourceTitles: ['Area 51 Saison 2'] }, candidate('42', 'Area 51 2nd Season')],
      [{ explicitSeason: 2, sourceTitles: ['Area 51'] }, { ...candidate('42', 'Area 52'), season: 2 }],
    ];
    for (const [query, value] of cases) expect(inspectPublicCandidates(query, [value])).toEqual(inspectFavoriteTitleCandidates(query, [value]));
  });

  it('P-01 matches accents, case, punctuation and spacing', () => {
    expect(matchFavoriteTitles({ sourceTitles: ["L’Épopée de Frieren"] }, [envelope([candidate('1', 'l epopee de frieren')])])).toMatchObject({ kind: 'MATCH', level: 'ordered-exact' });
  });

  it('P-02 compares compact keys after shared normalization', () => {
    expect(matchFavoriteTitles({ sourceTitles: ['One Piece'] }, [envelope([candidate('1', 'OnePiece')])])).toMatchObject({ kind: 'MATCH', level: 'ordered-exact' });
  });

  it('P-03 matches the same significant-word multiset in another order', () => {
    expect(matchFavoriteTitles({ sourceTitles: ['The Apothecary Diaries'] }, [envelope([candidate('1', 'Diaries Apothecary')])])).toMatchObject({ kind: 'MATCH', level: 'reordered-significant-words' });
  });

  it('P-04 accepts only the documented bounded edit distance', () => {
    expect(matchFavoriteTitles({ sourceTitles: ['Sousou no Frieren'] }, [envelope([candidate('1', 'Sousou no Friren')])])).toMatchObject({ kind: 'MATCH', level: 'bounded-edit-distance' });
  });

  it('P-05 returns an order-independent ambiguity for distinct references', () => {
    const candidates = [candidate('2', 'Frieren'), candidate('1', 'Frieren')];
    const forward = matchFavoriteTitles({ sourceTitles: ['Frieren'] }, [envelope(candidates)]);
    const reverse = matchFavoriteTitles({ sourceTitles: ['Frieren'] }, [envelope([...candidates].reverse())]);
    expect(forward).toEqual(reverse);
    expect(forward).toMatchObject({ candidateReferences: [{ externalId: '1' }, { externalId: '2' }], kind: 'AMBIGUOUS' });
  });

  it('P-06 ignores unrelated candidates regardless of response position', () => {
    expect(matchFavoriteTitles({ sourceTitles: ['Frieren'] }, [envelope([candidate('popular', 'Popular Hero Academia')])])).toMatchObject({ kind: 'NO_MATCH' });
  });

  it('P-07 rejects prefix and subtitle-only matches', () => {
    expect(matchFavoriteTitles({ sourceTitles: ["Frieren Beyond Journey's End"] }, [envelope([candidate('1', 'Frieren')])])).toMatchObject({ kind: 'NO_MATCH' });
  });

  it('P-08 rejects stemming and token-coverage matches', () => {
    expect(matchFavoriteTitles({ sourceTitles: ['Magical Girls Academy'] }, [envelope([candidate('1', 'Magic Girl')])])).toMatchObject({ kind: 'NO_MATCH' });
  });

  it('selects source ID and canonical URL before title evidence', () => {
    const candidates = [
      { ...candidate('1', 'Wrong title'), canonicalUrl: 'https://anilist.co/anime/1' },
      { ...candidate('2', 'Frieren'), canonicalUrl: 'https://anilist.co/anime/2' },
    ];
    expect(matchFavoriteTitles({ explicitProviderReference: { externalId: '1', provider: 'anilist' }, sourceTitles: ['Frieren'] }, [envelope(candidates)])).toMatchObject({ kind: 'MATCH', level: 'source-id', matchedReference: { externalId: '1' } });
    expect(matchFavoriteTitles({ sourceCanonicalUrl: 'https://anilist.co/anime/1', sourceTitles: ['Frieren'] }, [envelope(candidates)])).toMatchObject({ kind: 'MATCH', level: 'source-url', matchedReference: { externalId: '1' } });
  });

  it('uses an explicitly corroborated season before reordered words', () => {
    const candidates = [
      { ...candidate('1', 'The Journey Season 1'), season: 1 },
      { ...candidate('2', 'The Journey Season 2'), season: 2 },
    ];
    expect(matchFavoriteTitles({ explicitSeason: 2, sourceTitles: ['The Journey'] }, [envelope(candidates)])).toMatchObject({ kind: 'MATCH', level: 'explicit-season', matchedReference: { externalId: '2' } });
  });

  it('F-01 and F-02 require symmetric OVA and pre-serialization compatibility', () => {
    const ova = { ...candidate('ova', 'Frieren'), format: 'OVA' };
    const ordinary = candidate('tv', 'Frieren');
    const pre = { ...candidate('pre', 'Frieren'), preSerialization: true };
    expect(isProviderCandidateCompatible({ sourceFormat: 'OVA', sourceTitles: ['Frieren'] }, ova)).toBe(true);
    expect(isProviderCandidateCompatible({ sourceFormat: 'OVA', sourceTitles: ['Frieren'] }, ordinary)).toBe(false);
    expect(isProviderCandidateCompatible({ sourceFormat: 'TV', sourceTitles: ['Frieren'] }, ova)).toBe(false);
    expect(isProviderCandidateCompatible({ preSerialization: true, sourceTitles: ['Frieren'] }, pre)).toBe(true);
    expect(isProviderCandidateCompatible({ preSerialization: true, sourceTitles: ['Frieren'] }, ordinary)).toBe(false);
    expect(isProviderCandidateCompatible({ preSerialization: false, sourceTitles: ['Frieren'] }, pre)).toBe(false);
  });

  it('C-01 blocks exact normalized taxonomy and C-02 never blocks substrings', () => {
    const exact = { ...candidate('1', 'Fixture'), categories: ['Explicit-Séx'] };
    const substring = { ...candidate('2', 'Fixture'), categories: ['Discussion of explicit sex in literature'] };
    expect(hasExactBlockedProviderTaxonomy(exact)).toBe(true);
    expect(hasExactBlockedProviderTaxonomy(substring)).toBe(false);
  });

  it('fails closed before matching an incomplete response', () => {
    const incomplete = createProviderCandidateEnvelope({ candidates: [candidate('1', 'Frieren')], complete: false, digest: 'digest-incomplete', provider: 'anilist', truncated: true });
    expect(matchFavoriteTitles({ sourceTitles: ['Frieren'] }, [incomplete])).toEqual({ kind: 'INCOMPLETE_CANDIDATE_SET' });
  });

  it('bounds source aliases before preparing candidates', () => {
    expect(() => matchFavoriteTitles({ sourceTitles: Array.from({ length: 17 }, () => 'Frieren') }, [envelope([])])).toThrow(/at most 16/u);
  });

  it('rejects punctuation-only aliases instead of comparing empty keys', () => {
    expect(() => matchFavoriteTitles({ sourceTitles: ['---'] }, [envelope([])])).toThrow(/letter or number/u);
  });

  it('keeps Hunter × Hunter editions ambiguous across typographic title variants', () => {
    const editions = [candidate('1999', 'Hunter x Hunter'), candidate('2011', 'Hunter × Hunter')];
    expect(matchFavoriteTitles({ sourceTitles: ['Hunter × Hunter'] }, [envelope(editions)])).toMatchObject({ kind: 'AMBIGUOUS', level: 'ordered-exact' });
  });

  it('keeps an exact title and its safe parenthesized edition comparable', () => {
    const editions = [candidate('base', 'Existence'), candidate('wangho', 'Existence (Wangho)')];
    expect(matchFavoriteTitles({ sourceTitles: ['Existence'] }, [envelope(editions)])).toMatchObject({
      candidateReferences: [{ externalId: 'base' }, { externalId: 'wangho' }], kind: 'AMBIGUOUS', level: 'ordered-exact',
    });
    expect(matchFavoriteTitles({ sourceTitles: ['Existence'] }, [envelope([editions[1]!])])).toMatchObject({ kind: 'MATCH', matchedReference: { externalId: 'wangho' } });
  });

  it('gives the complete parenthesized source title priority over its aliases', () => {
    const editions = [candidate('base', 'Existence'), candidate('wangho', 'Existence (Wangho)')];
    expect(matchFavoriteTitles({ sourceTitles: ['Existence (Wangho)', 'Existence', 'Wangho'] }, [envelope(editions)])).toMatchObject({
      kind: 'MATCH', level: 'ordered-exact', matchedReference: { externalId: 'wangho' },
    });
  });

  it('does not turn year, format or nested parentheses into comparable identities', () => {
    const qualified = [candidate('year', 'Existence (2024)'), candidate('ova', 'Existence (OVA)'), candidate('nested', 'Existence ((Wangho))')];
    expect(matchFavoriteTitles({ sourceTitles: ['Existence'] }, [envelope(qualified)])).toMatchObject({ kind: 'NO_MATCH' });
  });

  it('accepts a unique minor typo but preserves intrinsic numbers and corroborated seasons', () => {
    expect(matchFavoriteTitles({ sourceTitles: ['Frieran'] }, [envelope([candidate('1', 'Frieren')])])).toMatchObject({ kind: 'MATCH', level: 'bounded-edit-distance' });
    expect(matchFavoriteTitles({ sourceTitles: ['Synthetic Number 20'] }, [envelope([candidate('1', 'Synthetic Number 21')])])).toMatchObject({ kind: 'NO_MATCH' });
    expect(matchFavoriteTitles({ explicitSeason: 2, sourceTitles: ['Synthetic Journey'] }, [envelope([{ ...candidate('1', 'Synthetic Journey'), season: 1 }])])).toMatchObject({ kind: 'NO_MATCH' });
  });

  it('compares corroborated season suffixes in both titles without removing intrinsic numbers', () => {
    expect(matchFavoriteTitles({ explicitSeason: 2, sourceTitles: ['Area 51 Saison 2'] }, [envelope([candidate('1', 'Area 51 2nd Season'), candidate('2', 'Area 52 2nd Season')])])).toMatchObject({ kind: 'MATCH', level: 'explicit-season', matchedReference: { externalId: '1' } });
  });
});
