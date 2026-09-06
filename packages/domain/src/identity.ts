import { invariant } from './invariant';

declare const identityBrand: unique symbol;

type StableId<TKind extends string> = string & {
  readonly [identityBrand]: TKind;
};

export type WorkId = StableId<'work'>;
export type FavoriteSourceId = StableId<'source'>;
export type LibraryId = StableId<'library'>;
export type ProgressId = StableId<'progress'>;
export type ReviewId = StableId<'review'>;
export type AgendaEntryId = StableId<'agenda'>;
export type ReminderId = StableId<'reminder'>;

const idPattern = /^[a-z]+_[a-z0-9][a-z0-9_-]{5,}$/;

function stableId<TKind extends string>(value: string, prefix: TKind): StableId<TKind> {
  invariant(idPattern.test(value) && value.startsWith(`${prefix}_`), 'invalid-id', `Expected a stable ${prefix} identifier.`);
  // SAFETY: the prefix and complete identifier grammar are validated above before applying the opaque domain brand.
  return value as StableId<TKind>;
}

export const workId = (value: string): WorkId => stableId(value, 'work');
export const favoriteSourceId = (value: string): FavoriteSourceId => stableId(value, 'source');
export const libraryId = (value: string): LibraryId => stableId(value, 'library');
export const progressId = (value: string): ProgressId => stableId(value, 'progress');
export const reviewId = (value: string): ReviewId => stableId(value, 'review');
export const agendaEntryId = (value: string): AgendaEntryId => stableId(value, 'agenda');
export const reminderId = (value: string): ReminderId => stableId(value, 'reminder');
