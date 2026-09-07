import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { FavoriteProvider, ProviderCandidate, ProviderCandidateEnvelope } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { matchFavoriteTitles } from './provider-matcher';

function candidate(externalId: string, title: string, provider: FavoriteProvider = 'anilist'): ProviderCandidate {
  return { externalId, mediaKind: provider === 'anilist' ? 'ANIME' : 'MANGA', preSerialization: false, provider, titles: [title] };
}

function envelope(candidates: readonly ProviderCandidate[], provider: FavoriteProvider = 'anilist'): ProviderCandidateEnvelope {
  return createProviderCandidateEnvelope({ candidates, complete: true, digest: `digest-${provider}`, provider, truncated: false });
}

describe('deterministic favorite title matcher P-01…P-08', () => {
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
});
