import type { FavoriteMediaKind, FavoriteSource } from '@tobirink/domain';
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

export async function projectFavoriteSources(storage: StoragePort, resolvedWorkIds: ReadonlySet<string>): Promise<{ pending: LibraryCatalogueItem[]; sourceByWorkId: ReadonlyMap<string, FavoriteSource> }> {
  const pending: LibraryCatalogueItem[] = [];
  const sourceByWorkId = new Map<string, FavoriteSource>();
  let afterId: FavoriteSource['id'] | undefined;
  for (;;) {
    const sources = await storage.listFavoriteSources(afterId === undefined ? { limit: libraryCatalogueReadBatchSize } : { afterId, limit: libraryCatalogueReadBatchSize });
    if (sources.length === 0) break;
    const page = await storage.transaction(['favoriteArtifacts'], async (session) => Promise.all(sources.map(async (source) => ({ artifact: await session.getFavoriteParseArtifact(source.id), source }))));
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
        state: pendingState(source.resolution),
        title,
      });
    }
    afterId = sources.at(-1)?.id;
    if (sources.length < libraryCatalogueReadBatchSize) break;
  }
  return { pending, sourceByWorkId };
}
