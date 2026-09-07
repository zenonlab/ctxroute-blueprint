import type { FavoriteSourceId, ReviewId } from './identity';
import type { FavoritePresence } from './favorites';
import { canonicalDateTime, invariant, nonNegativeNumber, requiredText } from './invariant';

export interface FavoriteSource {
  bookmarkId: string;
  folderPath: readonly string[];
  id: FavoriteSourceId;
  importedAt: string;
  order: number;
  presence: FavoritePresence;
  reviewId: ReviewId;
  title: string;
  url: string;
}

export type FavoriteSourceInput = Omit<FavoriteSource, 'presence'> & Partial<Pick<FavoriteSource, 'presence'>>;

function httpUrl(value: string): string {
  const normalized = requiredText(value, 'favoriteSource.url');
  invariant(/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/iu.test(normalized), 'invalid-url', 'Favorite source URL must use HTTP(S).');
  return normalized;
}

export function createFavoriteSource(input: FavoriteSourceInput): FavoriteSource {
  const order = nonNegativeNumber(input.order, 'favoriteSource.order');
  invariant(Number.isInteger(order), 'invalid-number', 'favoriteSource.order must be an integer.');
  const presence = input.presence ?? 'observed';
  invariant(presence === 'observed' || presence === 'detached', 'invalid-favorite-presence', 'Favorite source presence must be observed or detached.');
  return Object.freeze({
    ...input,
    bookmarkId: requiredText(input.bookmarkId, 'favoriteSource.bookmarkId'),
    folderPath: Object.freeze(input.folderPath.map((segment) => requiredText(segment, 'favoriteSource.folderPath'))),
    importedAt: canonicalDateTime(input.importedAt, 'favoriteSource.importedAt'),
    order,
    presence,
    title: requiredText(input.title, 'favoriteSource.title'),
    url: httpUrl(input.url),
  });
}
