import { createLibrary, createWork, libraryId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { describe, expect, it } from 'vitest';
import { libraryCatalogueResponseSchema } from './library-catalogue-messages';
import { readLocalLibraryCatalogueSnapshot } from './local-library-catalogue-runtime';

describe('local library catalogue projection', () => {
  it('bounds display strings without changing the stored work', async () => {
    const storage = new MemoryStoragePort();
    const title = `Synthetic ${'a'.repeat(390)}`;
    const work = createWork({
      externalReferences: [{ externalId: '42', provider: 'anilist' }],
      hydration: {
        candidate: { externalId: '42', format: 'TV', mediaKind: 'ANIME', metadataVersion: 1, preSerialization: false, provider: 'anilist', titles: [title] },
        favoriteAliasKeys: [],
        hydratedAt: '2026-09-09T00:00:00.000Z',
        matcherVersion: 'matcher-v3',
        providerTitleKeys: [],
      },
      id: workId('work_bounded-projection'),
      mediaKind: 'anime',
      preferredTitle: title,
    });
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [work.id]));
    await storage.putWork(work);

    const snapshot = await readLocalLibraryCatalogueSnapshot(storage, libraryId('library_primary'), { sort: 'TITLE_ASC' });

    expect(snapshot.items[0]?.title.length).toBe(300);
    expect(snapshot.items[0]?.detail).toBe('TV');
    expect((await storage.getWork(work.id))?.preferredTitle).toBe(title);
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
  });
});
