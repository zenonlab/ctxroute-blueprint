import { describe, expect, it, vi } from 'vitest';
import type { PublicDiscoveryClaimedRequest } from './contracts';
import type { FavoriteProviderPort, ProviderCandidate, ResolutionProvider } from './provider-kit';
import { createPublicDiscoveryResolver } from './resolver';
import type { PublicDiscoveryProviderPorts } from './resolver';

function candidate(provider: ResolutionProvider, mediaKind: ProviderCandidate['mediaKind'], externalId: string, title: string): ProviderCandidate {
  return { externalId, mediaKind, preSerialization: false, provider, titles: [title] };
}

function port(provider: ResolutionProvider, result?: ProviderCandidate): FavoriteProviderPort & { hydrate: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> } {
  return {
    hydrate: vi.fn(async () => result),
    search: vi.fn(async () => ({ candidates: result === undefined ? [] : [result], complete: true, digest: `${provider}:fixture`, provider, truncated: false })),
  };
}

function request(mediaKind: PublicDiscoveryClaimedRequest['query']['mediaKind'], title = 'Target'): PublicDiscoveryClaimedRequest {
  return {
    attempt: 1,
    key: { fingerprint: 'a'.repeat(64), mediaKind, parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
    query: { discoveryTitles: [title], mediaKind, sourceTitles: [title] },
    requestDigest: 'b'.repeat(64),
    schemaVersion: 2,
  };
}

function providers(values: Partial<Record<ResolutionProvider, ProviderCandidate>> = {}): PublicDiscoveryProviderPorts & Record<ResolutionProvider, ReturnType<typeof port>> {
  return {
    anilist: port('anilist', values.anilist),
    mangaupdates: port('mangaupdates', values.mangaupdates),
    mangadex: port('mangadex', values.mangadex),
    'kitsu-anime': port('kitsu-anime', values['kitsu-anime']),
    'kitsu-manga': port('kitsu-manga', values['kitsu-manga']),
  };
}

describe('standalone provider resolver', () => {
  it('uses AniList then Kitsu Anime without touching manga providers', async () => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-anime' } } });
    expect(ports.anilist.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
  });

  it('uses MangaUpdates, MangaDex and Kitsu Manga in order', async () => {
    const ports = providers({ 'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target') });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-manga' } } });
    expect(ports.mangaupdates.search).toHaveBeenCalledOnce();
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('reports ambiguity when unknown media matches both provider lanes', async () => {
    const ports = providers({
      anilist: candidate('anilist', 'ANIME', '1', 'Target'),
      mangaupdates: candidate('mangaupdates', 'MANGA', '2', 'Target'),
    });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).resolves.toMatchObject({ state: 'AMBIGUOUS', candidates: [{ provider: 'anilist' }, { provider: 'mangaupdates' }] });
  });

  it('hydrates an explicit provider identity without searching', async () => {
    const exact = candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc', 'Target');
    const ports = providers({ mangadex: exact });
    const base = request('MANGA');
    const input = {
      ...base,
      query: {
        ...base.query,
        explicitProviderReference: { externalId: exact.externalId, provider: 'mangadex' as const },
      },
    };
    await expect(createPublicDiscoveryResolver(ports).resolve(input)).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: exact } });
    expect(ports.mangadex.search).not.toHaveBeenCalled();
    expect(ports.mangadex.hydrate).toHaveBeenCalledOnce();
  });
});
