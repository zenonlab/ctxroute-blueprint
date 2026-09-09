import { describe, expect, it, vi } from 'vitest';
import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { ProviderCandidate } from '@tobirink/domain';
import type { FavoriteProviderCandidatePort } from './provider-ports';
import { favoriteSearchCheckpointSchema, searchFavoriteProviderPage } from './provider-search-checkpoint';
import type { FavoriteSearchCheckpoint, FavoriteSearchCheckpointPort } from './provider-search-checkpoint';

const query = { sourceTitles: ['Synthetic Journey'] };
const candidate = (id: string, title = 'Synthetic Journey'): ProviderCandidate => ({ externalId: id, mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: [title] });
function checkpointPort(): FavoriteSearchCheckpointPort {
  let serialized: string | undefined;
  return {
    now: () => 1000,
    read: async () => serialized === undefined ? undefined : favoriteSearchCheckpointSchema.parse(JSON.parse(serialized)),
    save: async (value) => { serialized = JSON.stringify(value); },
  };
}

describe('durable relevant candidate pagination', () => {
  it('does not select an early exact result before a later identity has been compared', async () => {
    const checkpoint = checkpointPort();
    const port: FavoriteProviderCandidatePort = { search: vi.fn(async (input) => createProviderCandidateEnvelope(input.cursor === undefined
      ? { candidates: [candidate('1')], complete: false, digest: 'first', nextCursor: '2', provider: 'anilist', truncated: true }
      : { candidates: [candidate('2')], complete: true, digest: 'second', provider: 'anilist', truncated: false })) };
    expect(await searchFavoriteProviderPage(port, query, 'anilist', 20, checkpoint)).toEqual({ kind: 'PAGE_PENDING' });
    const result = await searchFavoriteProviderPage(port, query, 'anilist', 20, checkpoint);
    expect(result).toMatchObject({ envelope: { candidates: [{ externalId: '1' }, { externalId: '2' }], complete: true }, kind: 'ENVELOPE' });
    expect(port.search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: '2' }));
  });

  it('keeps only the highest proof level across pages without relying on API order', async () => {
    const checkpoint = checkpointPort();
    const port: FavoriteProviderCandidatePort = { search: async (input) => createProviderCandidateEnvelope(input.cursor === undefined
      ? { candidates: [candidate('fuzzy', 'Synthetic Jurney')], complete: false, digest: 'fuzzy', nextCursor: '2', provider: 'anilist', truncated: true }
      : { candidates: [candidate('exact')], complete: true, digest: 'exact', provider: 'anilist', truncated: false }) };
    await searchFavoriteProviderPage(port, query, 'anilist', 20, checkpoint);
    expect(await searchFavoriteProviderPage(port, query, 'anilist', 20, checkpoint)).toMatchObject({ envelope: { candidates: [{ externalId: 'exact' }] } });
  });

  it('persists version 2 display metadata and advances across an empty evidence page', async () => {
    const checkpoint = checkpointPort();
    const first = createProviderCandidateEnvelope({ candidates: [], complete: false, digest: 'empty', nextCursor: '2', provider: 'anilist', truncated: true });
    const richCandidate: ProviderCandidate = {
      ...candidate('rich'),
      cover: { attribution: 'AniList', url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/example.jpg' },
      displayTitle: 'Synthetic Journey',
      metadataVersion: 2,
      titleVariants: [{ language: 'en', title: 'Synthetic Journey' }],
    };
    const port: FavoriteProviderCandidatePort = { search: vi.fn(async (input) => input.cursor === undefined
      ? first
      : createProviderCandidateEnvelope({ candidates: [richCandidate], complete: true, digest: 'rich', provider: 'anilist', truncated: false })) };

    expect(await searchFavoriteProviderPage(port, query, 'anilist', 20, checkpoint)).toEqual({ kind: 'PAGE_PENDING' });
    expect(await searchFavoriteProviderPage(port, query, 'anilist', 20, checkpoint)).toMatchObject({ envelope: { candidates: [richCandidate], complete: true } });
  });

  it('searches all local aliases before declaring a provider NO_MATCH', async () => {
    const checkpoint = checkpointPort();
    const port: FavoriteProviderCandidatePort = { search: vi.fn(async (input) => createProviderCandidateEnvelope({ candidates: input.titles[0] === 'Other Alias' ? [candidate('alias', 'Other Alias')] : [], complete: true, digest: 'alias-search', provider: 'anilist', truncated: false })) };
    const aliases = { sourceTitles: ['Synthetic Journey', 'Other Alias'] };
    expect(await searchFavoriteProviderPage(port, aliases, 'anilist', 20, checkpoint)).toEqual({ kind: 'PAGE_PENDING' });
    expect(await searchFavoriteProviderPage(port, aliases, 'anilist', 20, checkpoint)).toMatchObject({ envelope: { candidates: [{ externalId: 'alias' }], complete: true } });
  });

  it('preserves the previous checkpoint when transport or persistence fails', async () => {
    const checkpoint = checkpointPort();
    const page = createProviderCandidateEnvelope({ candidates: [candidate('1')], complete: false, digest: 'page', nextCursor: '2', provider: 'anilist', truncated: true });
    await searchFavoriteProviderPage({ search: async () => page }, query, 'anilist', 20, checkpoint);
    const previous = await checkpoint.read('anilist');
    await expect(searchFavoriteProviderPage({ search: async () => { throw new Error('offline'); } }, query, 'anilist', 20, checkpoint)).rejects.toThrow('offline');
    expect(await checkpoint.read('anilist')).toEqual(previous);
    const failedWrite = { ...checkpoint, save: async (_value: FavoriteSearchCheckpoint) => { throw new Error('interrupted'); } };
    await expect(searchFavoriteProviderPage({ search: async () => ({ ...page, nextCursor: '3' }) }, query, 'anilist', 20, failedWrite)).rejects.toThrow('interrupted');
    expect(await checkpoint.read('anilist')).toEqual(previous);
  });
});
