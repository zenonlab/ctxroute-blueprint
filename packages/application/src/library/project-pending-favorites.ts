import { createLibrary } from '@tobirink/domain';
import type { FavoriteMediaKind, FavoriteSource, FavoriteSourceId, LibraryId, WorkId } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { libraryCatalogueReadBatchSize } from './library-catalogue-contract';
import type { LibraryCatalogueItem } from './library-catalogue-contract';

function projectedMediaKind(value: FavoriteMediaKind): LibraryCatalogueItem['mediaKind'] {
  return value === 'ANIME' ? 'anime' : value === 'UNKNOWN' ? 'unknown' : 'manga';
}

function pendingState(resolution: FavoriteSource['resolution']): LibraryCatalogueItem['state'] {
  if (resolution?.kind === 'RETRYABLE') return 'retryable';
  if (resolution?.kind === 'REVIEW_REQUIRED') return 'review';
  return 'preparation';
}

function preferredSource(left: FavoriteSource | undefined, right: FavoriteSource): FavoriteSource {
  if (left === undefined) return right;
  const order = left.folderPath.join('\u0000').localeCompare(right.folderPath.join('\u0000')) || left.order - right.order || left.id.localeCompare(right.id);
  return order <= 0 ? left : right;
}

function resolvedSourceWorkId(source: FavoriteSource): WorkId | undefined {
  return source.presence === 'observed' && source.resolution?.kind === 'RESOLVED' ? source.matchedWorkId : undefined;
}

export async function repairFavoriteLibraryProjection(storage: StoragePort, libraryId: LibraryId): Promise<void> {
  let knownIds = new Set((await storage.getLibrary(libraryId))?.workIds);
  let afterId: FavoriteSourceId | undefined;
  for (;;) {
    const query = afterId === undefined ? { limit: libraryCatalogueReadBatchSize } : { afterId, limit: libraryCatalogueReadBatchSize };
    const batch = await storage.listFavoriteSources(query);
    if (batch.length === 0) return;
    const needsRepair = batch.some((source) => {
      const id = resolvedSourceWorkId(source);
      return id !== undefined && !knownIds.has(id);
    });
    if (needsRepair) {
      knownIds = await storage.transaction(['favoriteSources', 'libraries', 'works'], async (session) => {
        const library = await session.getLibrary(libraryId) ?? createLibrary(libraryId);
        const ids = new Set(library.workIds);
        // Revalidate the page in the same transaction as the projection write;
        // an intervening detach or human decision must not project stale data.
        const sources = await session.listFavoriteSources(query);
        const missing = [...new Set(sources.map(resolvedSourceWorkId).filter((id): id is WorkId => id !== undefined && !ids.has(id)))];
        if (missing.length > 0) {
          const works = await session.getWorks(missing);
          for (const work of works) if (work !== undefined) ids.add(work.id);
        }
        if (ids.size !== library.workIds.length) await session.putLibrary(createLibrary(libraryId, [...ids]));
        return ids;
      });
    }
    afterId = batch.at(-1)?.id;
    if (batch.length < libraryCatalogueReadBatchSize) return;
  }
}

export async function projectFavoriteSources(storage: StoragePort, resolvedWorkIds: ReadonlySet<string>): Promise<{ pending: LibraryCatalogueItem[]; sourceByWorkId: ReadonlyMap<string, FavoriteSource> }> {
  const pending: LibraryCatalogueItem[] = [];
  const sourceByWorkId = new Map<string, FavoriteSource>();
  let afterId: FavoriteSource['id'] | undefined;
  for (;;) {
    const sources = await storage.listFavoriteSources(afterId === undefined ? { limit: libraryCatalogueReadBatchSize } : { afterId, limit: libraryCatalogueReadBatchSize });
    if (sources.length === 0) break;
    const page = await storage.transaction(['favoriteArtifacts'], async (session) => {
      const artifacts = await session.getFavoriteParseArtifacts(sources.map((source) => source.id));
      return sources.map((source, index) => ({ artifact: artifacts[index], source }));
    });
    for (const { artifact: record, source } of page) {
      if (source.presence !== 'observed' || source.resolution?.kind === 'UNSUPPORTED') continue;
      if (source.matchedWorkId !== undefined && resolvedWorkIds.has(source.matchedWorkId) && source.resolution?.kind === 'RESOLVED') {
        sourceByWorkId.set(source.matchedWorkId, preferredSource(sourceByWorkId.get(source.matchedWorkId), source));
        continue;
      }
      const artifact = record?.artifact;
      const explicitReference = artifact?.sourceEvidence.explicitProviderReference;
      const title = artifact?.displayTitle?.trim() || (explicitReference === undefined ? '' : source.title.trim());
      if (artifact === undefined || (artifact.status !== 'parsed' && explicitReference === undefined) || !title) continue;
      pending.push({
        addedOrder: source.order,
        id: `work_pending_${source.id.slice('source_'.length)}`,
        mediaKind: projectedMediaKind(artifact.mediaKind),
        source,
        sourceMediaKind: artifact.mediaKind,
        state: pendingState(source.resolution),
        title,
      });
    }
    afterId = sources.at(-1)?.id;
    if (sources.length < libraryCatalogueReadBatchSize) break;
  }
  return { pending, sourceByWorkId };
}
