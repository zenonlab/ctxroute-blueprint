import type { FavoriteSourceId, ReviewId, WorkId } from './identity';
import type { FavoritePresence } from './favorites';
import { canonicalDateTime, invariant, nonNegativeNumber, requiredText } from './invariant';

export type FavoriteResolutionResult =
  | { readonly kind: 'RESOLVED' }
  | { readonly kind: 'REVIEW_REQUIRED'; readonly reason: 'AMBIGUOUS' | 'NOT_FOUND' }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: 'IDENTITY_MISSING' | 'DETACHED' | 'BLOCKED_CONTENT_TAXONOMY' }
  | { readonly kind: 'RETRYABLE'; readonly reason: 'PROVIDER_UNAVAILABLE' | 'INCOMPLETE_CANDIDATE_SET' | 'AUTOMATIC_ATTEMPT_LIMIT' };

export interface FavoriteResolutionVersions {
  readonly schema: 1;
  readonly parser: string;
  readonly matcher: string;
  readonly siteRules: string;
  readonly decision: 1;
  readonly receipt: 1;
}

export interface FavoriteSource {
  bookmarkId: string;
  folderPath: readonly string[];
  id: FavoriteSourceId;
  importedAt: string;
  order: number;
  presence: FavoritePresence;
  matchedWorkId?: WorkId;
  resolution?: FavoriteResolutionResult;
  resolutionVersions?: FavoriteResolutionVersions;
  reviewId?: ReviewId;
  title: string;
  url: string;
}

export type FavoriteSourceInput = Omit<FavoriteSource, 'presence'> & Partial<Pick<FavoriteSource, 'presence'>>;

function httpUrl(value: string): string {
  const normalized = requiredText(value, 'favoriteSource.url');
  invariant(/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/iu.test(normalized), 'invalid-url', 'Favorite source URL must use HTTP(S).');
  return normalized;
}

function validateResolution(result: FavoriteResolutionResult): void {
  const allowed = result.kind === 'RESOLVED'
    ? Object.keys(result).length === 1
    : Object.keys(result).length === 2 && (
      result.kind === 'REVIEW_REQUIRED' && ['AMBIGUOUS', 'NOT_FOUND'].includes(result.reason)
      || result.kind === 'UNSUPPORTED' && ['IDENTITY_MISSING', 'DETACHED', 'BLOCKED_CONTENT_TAXONOMY'].includes(result.reason)
      || result.kind === 'RETRYABLE' && ['PROVIDER_UNAVAILABLE', 'INCOMPLETE_CANDIDATE_SET', 'AUTOMATIC_ATTEMPT_LIMIT'].includes(result.reason)
    );
  invariant(allowed, 'invalid-favorite-resolution', 'Favorite resolution must have a supported kind and reason.');
}

export function createFavoriteSource(input: FavoriteSourceInput): FavoriteSource {
  if (input.resolution !== undefined) validateResolution(input.resolution);
  if (input.resolutionVersions !== undefined) {
    const versions = input.resolutionVersions;
    invariant(versions.schema === 1 && versions.decision === 1 && versions.receipt === 1,
      'invalid-favorite-resolution', 'Unsupported favorite resolution version.');
    for (const version of [versions.parser, versions.matcher, versions.siteRules]) {
      invariant(version.trim().length > 0 && version.length <= 100,
        'invalid-favorite-resolution', 'Favorite resolution versions must be bounded identifiers.');
    }
  }
  const order = nonNegativeNumber(input.order, 'favoriteSource.order');
  invariant(Number.isInteger(order), 'invalid-number', 'favoriteSource.order must be an integer.');
  const presence = input.presence ?? 'observed';
  invariant(presence === 'observed' || presence === 'detached', 'invalid-favorite-presence', 'Favorite source presence must be observed or detached.');
  const source: FavoriteSource = {
    ...input,
    bookmarkId: requiredText(input.bookmarkId, 'favoriteSource.bookmarkId'),
    folderPath: Object.freeze(input.folderPath.map((segment) => requiredText(segment, 'favoriteSource.folderPath'))),
    importedAt: canonicalDateTime(input.importedAt, 'favoriteSource.importedAt'),
    order,
    presence,
    title: requiredText(input.title, 'favoriteSource.title'),
    url: httpUrl(input.url),
  };
  if (input.resolution !== undefined) source.resolution = Object.freeze({ ...input.resolution });
  if (input.resolutionVersions !== undefined) source.resolutionVersions = Object.freeze({ ...input.resolutionVersions });
  return Object.freeze(source);
}
