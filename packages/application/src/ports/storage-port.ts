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
  Work,
  WorkId,
} from '@tobirink/domain';

export const privateStoreNames = ['agenda', 'favoriteSources', 'libraries', 'progress', 'reminders', 'reviews', 'works'] as const;
export type PrivateStoreName = (typeof privateStoreNames)[number];

export interface FavoriteSourcePageQuery {
  afterId?: FavoriteSourceId;
  limit: number;
}

export interface StorageReadPort {
  getAgendaEntry(id: AgendaEntryId): Promise<AgendaEntry | undefined>;
  getFavoriteSource(id: FavoriteSourceId): Promise<FavoriteSource | undefined>;
  getLibrary(id: LibraryId): Promise<Library | undefined>;
  getProgress(id: ProgressId): Promise<Progress | undefined>;
  getReminder(id: ReminderId): Promise<Reminder | undefined>;
  getReview(id: ReviewId): Promise<Review | undefined>;
  getWork(id: WorkId): Promise<Work | undefined>;
  listFavoriteSources(query: FavoriteSourcePageQuery): Promise<readonly FavoriteSource[]>;
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
