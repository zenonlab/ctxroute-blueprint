import {
  createFavoriteSource,
  createReview,
  favoriteSourceId,
  reviewId,
} from '@tobirink/domain';
import type { FavoriteSourceId, ReviewId } from '@tobirink/domain';
import type { ImportableFavorite } from '../resolution';
import type { StoragePort } from '../ports/storage-port';

export const favoriteImportBatchSize = 100;

export interface FavoriteImportSummary {
  ignored: number;
  imported: number;
}

function encodedBookmarkIdentity(bookmarkId: string): string {
  const value = bookmarkId.trim();
  if (!value) throw new Error('bookmarkId is required.');
  const hexadecimal = [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hexadecimal.length.toString(36)}_${hexadecimal}`.padEnd(6, '0');
}

function sourceIdentity(bookmarkId: string): FavoriteSourceId {
  return favoriteSourceId(`source_${encodedBookmarkIdentity(bookmarkId)}`);
}

function reviewIdentity(bookmarkId: string): ReviewId {
  return reviewId(`review_${encodedBookmarkIdentity(bookmarkId)}`);
}

export async function importFavoriteSources(
  favorites: readonly ImportableFavorite[],
  storage: StoragePort,
  importedAt: string,
): Promise<FavoriteImportSummary> {
  const eligible = favorites.filter((favorite) => favorite.state === 'eligible');

  for (let offset = 0; offset < eligible.length; offset += favoriteImportBatchSize) {
    const batch = eligible.slice(offset, offset + favoriteImportBatchSize);
    await storage.transaction(['favoriteSources', 'reviews'], async (session) => {
      for (const favorite of batch) {
        const id = sourceIdentity(favorite.bookmarkId);
        const existingSource = await session.getFavoriteSource(id);
        const linkedReviewId = existingSource?.reviewId ?? reviewIdentity(favorite.bookmarkId);
        const existingReview = await session.getReview(linkedReviewId);
        const review = createReview(existingReview
          ? { ...existingReview, sourceLabel: favorite.url, title: favorite.title }
          : { id: linkedReviewId, sourceLabel: favorite.url, status: 'pending', title: favorite.title });
        const source = createFavoriteSource({
          bookmarkId: favorite.bookmarkId,
          folderPath: favorite.folderPath,
          id,
          importedAt: existingSource?.importedAt ?? importedAt,
          order: favorite.order,
          reviewId: review.id,
          title: favorite.title,
          url: favorite.url,
        });
        await session.putReview(review);
        await session.putFavoriteSource(source);
      }
    });
  }

  return Object.freeze({ ignored: favorites.length - eligible.length, imported: eligible.length });
}
