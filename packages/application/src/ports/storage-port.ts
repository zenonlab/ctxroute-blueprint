import type {
  AgendaEntry,
  AgendaEntryId,
  FavoriteSource,
  FavoriteSourceId,
  Library,
  LibraryId,
  Progress,
  ProgressId,
  Reminder,
  ReminderId,
  Review,
  ReviewId,
  ReviewStatus,
  Work,
  WorkId,
} from '@tobirink/domain';

export const privateStoreNames = ['agenda', 'favoriteSources', 'libraries', 'progress', 'reminders', 'reviews', 'works'] as const;
export type PrivateStoreName = (typeof privateStoreNames)[number];

export interface FavoriteSourcePageQuery {
  afterId?: FavoriteSourceId;
  limit: number;
}

export const agendaEntryListLimit = 100;

export interface AgendaEntryListQuery {
  from: string;
  limit: number;
  to: string;
}

export function assertAgendaEntryListQuery(query: AgendaEntryListQuery): void {
  const from = new Date(query.from);
  const to = new Date(query.to);
  const canonical = !Number.isNaN(from.valueOf()) && !Number.isNaN(to.valueOf())
    && from.toISOString() === query.from && to.toISOString() === query.to;
  if (!canonical || from >= to) throw new TypeError('Agenda period requires increasing canonical ISO bounds.');
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > agendaEntryListLimit) {
    throw new RangeError('Agenda entry limit must be an integer between 1 and 100.');
  }
}

export interface ReviewListQuery {
  limit: number;
  status: ReviewStatus;
}

export const reviewMatchListLimit = 100;

export interface ReviewMatchListQuery {
  limit: number;
  workId: WorkId;
}

export function assertReviewMatchListQuery(query: ReviewMatchListQuery): void {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > reviewMatchListLimit) {
    throw new RangeError('Matched Review limit must be an integer between 1 and 100.');
  }
}

export interface StorageReadPort {
  getAgendaEntry(id: AgendaEntryId): Promise<AgendaEntry | undefined>;
  getFavoriteSource(id: FavoriteSourceId): Promise<FavoriteSource | undefined>;
  findFavoriteSourceByReviewId(reviewId: ReviewId): Promise<FavoriteSource | undefined>;
  getLibrary(id: LibraryId): Promise<Library | undefined>;
  getProgress(id: ProgressId): Promise<Progress | undefined>;
  getReminder(id: ReminderId): Promise<Reminder | undefined>;
  getReview(id: ReviewId): Promise<Review | undefined>;
  getWork(id: WorkId): Promise<Work | undefined>;
  listAgendaEntries(query: AgendaEntryListQuery): Promise<readonly AgendaEntry[]>;
  listFavoriteSources(query: FavoriteSourcePageQuery): Promise<readonly FavoriteSource[]>;
  listReviews(query: ReviewListQuery): Promise<readonly Review[]>;
  listReviewsByWorkId(query: ReviewMatchListQuery): Promise<readonly Review[]>;
}

export interface StorageWritePort {
  putAgendaEntry(entry: AgendaEntry): Promise<void>;
  putFavoriteSource(source: FavoriteSource): Promise<void>;
  putLibrary(library: Library): Promise<void>;
  putProgress(progress: Progress): Promise<void>;
  putReminder(reminder: Reminder): Promise<void>;
  putReview(review: Review): Promise<void>;
  putWork(work: Work): Promise<void>;
}

export type StorageSession = StorageReadPort & StorageWritePort;

export interface StoragePort extends StorageSession {
  transaction<TResult>(stores: readonly PrivateStoreName[], operation: (session: StorageSession) => Promise<TResult>): Promise<TResult>;
}
