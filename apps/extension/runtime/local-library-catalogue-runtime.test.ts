import { createFavoriteSource, createSourceEvidence, createLibrary, createWork, libraryId, workId } from '@tobirink/domain';
import type { FavoriteMediaKind } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { importFavoriteSources } from '@tobirink/application';
import type { FavoriteSourceAdapter } from '@tobirink/application';
import { describe, expect, it } from 'vitest';
import { libraryCatalogueMessageSchema, libraryCatalogueResponseSchema } from './library-catalogue-messages';
import { readLocalLibraryCatalogueSnapshot } from './local-library-catalogue-runtime';

async function importLocalSource(storage: MemoryStoragePort, mediaKind: FavoriteMediaKind) {
  const adapter: FavoriteSourceAdapter = { id: 'fixture-comic', origins: ['https://reader.example'], analyze: (input, url) => createSourceEvidence({ aliases: [], canonicalUrl: url.url, diagnostics: [], key: input.sourceKey, mediaKind, proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-comic', strategy: 'exact-origin', title: 'Local River' }) };
  await importFavoriteSources([{ bookmarkId: 'local-comic', folderPath: [], order: 1, state: 'eligible', title: 'Local River', url: 'https://reader.example/series/local-river' }], storage, '2026-09-26T00:00:00.000Z', [adapter]);
  return (await storage.listFavoriteSources({ limit: 1 }))[0]!;
}

describe('local library catalogue projection', () => {
  it.each([
    ['ADMISSION_WAIT', 'En attente d’admission'],
    ['PROVIDER_UNAVAILABLE', 'Fournisseur indisponible'],
    ['INCOMPLETE_CANDIDATE_SET', 'Recherche fournisseur incomplète'],
    ['PUBLIC_DISCOVERY_PENDING', 'Traitement distant en cours'],
    ['RATE_LIMITED', 'Limite de requêtes atteinte'],
    ['NETWORK', 'Erreur réseau'],
    ['TIMEOUT', 'Délai réseau dépassé'],
    ['SERVICE_UNAVAILABLE', 'Service indisponible'],
    ['AUTOMATIC_ATTEMPT_LIMIT', 'Limite de tentatives atteinte'],
    ['INTERNAL_FAILURE', 'Erreur interne'],
    ['CONTRACT_CONFLICT', 'Conflit de données'],
    ['INVALID_RESPONSE', 'Réponse distante invalide'],
  ] as const)('shows %s without claiming automatic recovery or inventing provider data', async (reason, label) => {
    const storage = new MemoryStoragePort();
    const source = await importLocalSource(storage, 'MANHWA');
    await storage.putFavoriteSource(createFavoriteSource({ ...source, resolution: { kind: 'RETRYABLE', reason } }));

    const snapshot = await readLocalLibraryCatalogueSnapshot(storage, libraryId('library_primary'), { sort: 'TITLE_ASC' });
    expect(snapshot.items[0]).toMatchObject({ detail: `Manhwa (source) · ${label}`, source: 'local', state: 'retryable' });
    expect(snapshot.items[0]?.coverSrc).toBeUndefined();
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
    expect((await storage.getFavoriteSource(source.id))?.resolution).toEqual({ kind: 'RETRYABLE', reason });
  });

  it.each([
    ['AMBIGUOUS', 'Plusieurs correspondances'],
    ['NOT_FOUND', 'Aucun résultat fournisseur'],
  ] as const)('explains %s Review without suggesting that the source was discarded', async (reason, label) => {
    const storage = new MemoryStoragePort();
    const source = await importLocalSource(storage, 'MANHUA');
    await storage.putFavoriteSource(createFavoriteSource({ ...source, resolution: { kind: 'REVIEW_REQUIRED', reason } }));
    const snapshot = await readLocalLibraryCatalogueSnapshot(storage, libraryId('library_primary'), { sort: 'TITLE_ASC' });
    expect(snapshot.items[0]).toMatchObject({ detail: `Manhua (source) · ${label} · À vérifier`, state: 'review' });
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
  });

  it('keeps an unknown pending type explicit instead of presenting it as manga', async () => {
    const storage = new MemoryStoragePort();
    await importLocalSource(storage, 'UNKNOWN');
    const snapshot = await readLocalLibraryCatalogueSnapshot(storage, libraryId('library_primary'), { sort: 'TITLE_ASC' });
    expect(snapshot.items[0]).toMatchObject({ detail: 'Type à déterminer · Préparation', mediaType: 'unknown', state: 'preparation' });
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
  });
  it('validates the full 1400-work projection and its late cursor at the actual UI boundary', async () => {
    const storage = new MemoryStoragePort();
    const ids = Array.from({ length: 1400 }, (_, index) => workId(`work_full${String(index).padStart(4, '0')}`));
    for (const id of ids) await storage.putWork(createWork({ id, externalReferences: [], preferredTitle: id, mediaKind: 'manga' }));
    await storage.putLibrary(createLibrary(libraryId('library_primary'), ids));
    const request = libraryCatalogueMessageSchema.parse({ type: 'library.catalogue.read', version: 1, offset: 1392, sort: 'TITLE_ASC' });
    const snapshot = await readLocalLibraryCatalogueSnapshot(storage, libraryId('library_primary'), request);
    expect(snapshot.items).toHaveLength(8);
    expect(snapshot.total).toBe(1400);
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
  });
  it('bounds display strings without changing the stored work', async () => {
    const storage = new MemoryStoragePort();
    const title = `Synthetic ${'a'.repeat(390)}`;
    const work = createWork({
      externalReferences: [{ externalId: '42', provider: 'anilist' }],
      hydration: {
        candidate: { canonicalUrl: 'https://anilist.co/anime/42', cover: { attribution: 'AniList', url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/fixture.jpg' }, externalId: '42', format: 'TV', mediaKind: 'ANIME', metadataVersion: 2, preSerialization: false, provider: 'anilist', titles: [title] },
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
    expect(snapshot.items[0]).toMatchObject({ coverAlt: expect.stringContaining('AniList'), coverSrc: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/fixture.jpg', href: 'https://anilist.co/anime/42' });
    expect((await storage.getWork(work.id))?.preferredTitle).toBe(title);
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
  });

  it('renders a local manga title while its provider resolution is pending', async () => {
    const storage = new MemoryStoragePort();
    const adapter: FavoriteSourceAdapter = { id: 'fixture-manga', origins: ['https://reader.example'], analyze: (input, url) => createSourceEvidence({ aliases: [], canonicalUrl: url.url, diagnostics: [], key: input.sourceKey, mediaKind: 'MANGA', proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-manga', strategy: 'exact-origin', title: 'Local Manga' }) };
    await importFavoriteSources([{ bookmarkId: 'local-manga', folderPath: [], order: 1, state: 'eligible', title: 'Local Manga chapitre 4', url: 'https://reader.example/series/local-manga' }], storage, '2026-09-12T00:00:00.000Z', [adapter]);

    const snapshot = await readLocalLibraryCatalogueSnapshot(storage, libraryId('library_primary'), { sort: 'ADDED_DESC' });

    expect(snapshot.items).toEqual([expect.objectContaining({ detail: 'Manga (source) · Préparation', href: 'https://reader.example/series/local-manga', mediaType: 'manga', source: 'local', state: 'preparation', title: 'Local Manga' })]);
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot }).success).toBe(true);
  });
});
