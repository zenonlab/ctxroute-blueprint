import { describe, expect, it, vi } from 'vitest';
import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { ProviderCandidate } from '@tobirink/domain';
import type { FavoriteProviderCandidatePort, ResolutionProvider } from './provider-ports';
import { resolveFavoriteProviderLanes } from './resolve-provider-lanes';

function candidate(provider: ResolutionProvider, externalId = '1', title = 'Synthetic Journey'): ProviderCandidate {
  return { externalId, mediaKind: provider === 'anilist' || provider === 'kitsu-anime' ? 'ANIME' : 'MANGA', preSerialization: false, provider, titles: [title] };
}

function provider(provider: ResolutionProvider, candidates: readonly ProviderCandidate[] = [], complete = true) {
  return { search: vi.fn(async () => createProviderCandidateEnvelope({ candidates, complete, digest: `fixture-${provider}`, provider, truncated: !complete })) };
}

function ports() {
  return { anilist: provider('anilist'), 'kitsu-anime': provider('kitsu-anime'), 'kitsu-manga': provider('kitsu-manga'), mangadex: provider('mangadex'), mangaupdates: provider('mangaupdates') };
}

const query = { sourceTitles: ['Synthetic Journey'] };

describe('independent provider lanes', () => {
  it.each(['offline', 'timeout', 'HTTP 429', 'malformed response'])('never arbitrates %s with Kitsu', async (failure) => {
    const candidates = ports();
    candidates.anilist.search.mockRejectedValue(new Error(failure));
    expect(await resolveFavoriteProviderLanes(candidates, query, 'ANIME')).toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
    expect(candidates['kitsu-anime'].search).not.toHaveBeenCalled();
  });

  it('falls back only after a complete primary NO_MATCH', async () => {
    const candidates = { ...ports(), 'kitsu-anime': provider('kitsu-anime', [candidate('kitsu-anime')]) };
    expect(await resolveFavoriteProviderLanes(candidates, query, 'ANIME')).toMatchObject({ decision: { kind: 'MATCH', matchedReference: { provider: 'kitsu-anime' } }, kind: 'COMPLETE' });
    expect(candidates.anilist.search).toHaveBeenCalledOnce();
    expect(candidates['kitsu-anime'].search).toHaveBeenCalledOnce();
  });

  it.each(['ANIME', 'MANGA', 'UNKNOWN'] as const)('keeps a primary 403 retryable for %s', async (kind) => {
    const candidates = { ...ports(), mangadex: provider('mangadex', [candidate('mangadex')]), 'kitsu-anime': provider('kitsu-anime', [candidate('kitsu-anime')]) };
    const primary = kind === 'ANIME' ? 'anilist' : 'mangaupdates';
    candidates[primary].search.mockRejectedValue(new Error('Favorite provider request failed with HTTP 403.'));
    expect(await resolveFavoriteProviderLanes(candidates, query, kind)).toMatchObject({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
    expect(candidates.mangadex.search).not.toHaveBeenCalled();
    expect(candidates['kitsu-manga'].search).not.toHaveBeenCalled();
    if (kind === 'ANIME') expect(candidates['kitsu-anime'].search).not.toHaveBeenCalled();
  });

  it('retains MangaUpdates authority when both manga providers could match', async () => {
    const candidates = { ...ports(), mangaupdates: provider('mangaupdates', [candidate('mangaupdates')]), mangadex: provider('mangadex', [candidate('mangadex')]) };
    expect(await resolveFavoriteProviderLanes(candidates, query, 'MANGA')).toMatchObject({ kind: 'COMPLETE', decision: { matchedReference: { provider: 'mangaupdates' } } });
    expect(candidates.mangadex.search).not.toHaveBeenCalled();
    expect(candidates['kitsu-manga'].search).not.toHaveBeenCalled();
  });

  it('stops on a primary ambiguity', async () => {
    const candidates = { ...ports(), anilist: provider('anilist', [candidate('anilist', '1'), candidate('anilist', '2')]) };
    expect(await resolveFavoriteProviderLanes(candidates, query, 'ANIME')).toMatchObject({ decision: { kind: 'AMBIGUOUS' } });
    expect(candidates['kitsu-anime'].search).not.toHaveBeenCalled();
  });

  it('does not turn a partial primary result into fallback authority', async () => {
    const candidates = { ...ports(), anilist: provider('anilist', [], false) };
    expect(await resolveFavoriteProviderLanes(candidates, query, 'ANIME')).toEqual({ kind: 'RETRYABLE', reason: 'INCOMPLETE_CANDIDATE_SET' });
    expect(candidates['kitsu-anime'].search).not.toHaveBeenCalled();
  });

  it('retains cross-media ambiguity even when the two matching levels differ', async () => {
    const candidates = { ...ports(), anilist: provider('anilist', [candidate('anilist')]), mangaupdates: provider('mangaupdates', [candidate('mangaupdates', '2', 'Synthetic Jurney')]) };
    const result = await resolveFavoriteProviderLanes(candidates, query, 'UNKNOWN');
    expect(result).toMatchObject({ decision: { candidateReferences: [{ provider: 'anilist' }, { provider: 'mangaupdates' }], kind: 'AMBIGUOUS', reasons: ['credible-identities-in-both-media-lanes'] } });
    expect(candidates['kitsu-anime'].search).not.toHaveBeenCalled();
    expect(candidates['kitsu-manga'].search).not.toHaveBeenCalled();
  });

  it('finishes the other lane before accepting an unknown media identity', async () => {
    const candidates = { ...ports(), anilist: provider('anilist', [candidate('anilist')]), 'kitsu-manga': provider('kitsu-manga', [candidate('kitsu-manga')]) };
    expect(await resolveFavoriteProviderLanes(candidates, query, 'UNKNOWN')).toMatchObject({ decision: { kind: 'AMBIGUOUS' } });
    expect(candidates['kitsu-anime'].search).not.toHaveBeenCalled();
    expect(candidates['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('does not accept one lane while the other is unavailable', async () => {
    const candidates: Record<ResolutionProvider, FavoriteProviderCandidatePort> = { ...ports(), anilist: provider('anilist', [candidate('anilist')]), mangaupdates: { search: async () => { throw new Error('offline'); } } };
    expect(await resolveFavoriteProviderLanes(candidates, query, 'UNKNOWN')).toMatchObject({ kind: 'RETRYABLE' });
  });
});
