import { createFavoriteParseArtifact, favoriteSourceId, reviewId } from '@tobirink/domain';
import type {
  AgendaEntry,
  AgendaEntryId,
  FavoriteSource,
  FavoriteResolutionVersions,
  FavoriteSourceId,
  Library,
  LibraryId,
  OrganizerConfiguration,
  Progress,
  ProgressId,
  Reminder,
  ReminderId,
  Review,
  ReviewId,
  ReviewStatus,
  Work,
  WorkId,
  FavoriteParseArtifact,
  FavoriteProvider,
  ProviderCandidate,
} from '@tobirink/domain';
import type { DurableTask } from '../tasks/task-state';
import type { BookmarkInventoryCursor } from './capability-ports';

export interface FavoriteInventoryCheckpoint {
  cursor?: BookmarkInventoryCursor;
  id: 'favorite-inventory';
  sessionId: string;
  startedAt: string;
  status: 'active' | 'complete';
}

export interface FavoriteInventoryMark {
  bookmarkId: string;
  sessionId: string;
}

export interface FavoriteBookmarkMutation {
  bookmarkId: string;
  kind: 'changed' | 'created' | 'moved' | 'removed';
  recordedAt: string;
  sequence: string;
}

export interface FavoriteProviderRateCheckpoint {
  nextAllowedAt: number;
  provider: Extract<FavoriteProvider, 'anilist' | 'kitsu-anime' | 'kitsu-manga' | 'mangaupdates'>;
}

export interface FavoriteResolutionReceipt {
  versions?: FavoriteResolutionVersions;
  completedAt: string;
  effectDigest: string;
  id: string;
  idempotencyKey: string;
  sourceId: FavoriteSourceId;
}

export interface FavoriteReviewCandidateSet {
  candidates: readonly ProviderCandidate[];
  digest: string;
  recordedAt: string;
  reviewId: ReviewId;
}

export interface FavoriteParseArtifactRecord {
  artifact: FavoriteParseArtifact;
  recordedAt: string;
  reviewId?: ReviewId;
  sourceId: FavoriteSourceId;
}

export function createFavoriteParseArtifactRecord(input: FavoriteParseArtifactRecord): FavoriteParseArtifactRecord {
  const recordedAt = new Date(input.recordedAt);
  if (Number.isNaN(recordedAt.valueOf()) || recordedAt.toISOString() !== input.recordedAt) throw new TypeError('recordedAt must be canonical.');
  const record = { ...input, artifact: createFavoriteParseArtifact(input.artifact), sourceId: favoriteSourceId(input.sourceId) };
  return Object.freeze(input.reviewId === undefined ? record : { ...record, reviewId: reviewId(input.reviewId) });
}

export const privateStoreNames = ['agenda', 'favoriteArtifacts', 'favoriteBookmarkMutations', 'favoriteInventoryCheckpoints', 'favoriteInventoryMarks', 'favoriteProviderRateCheckpoints', 'favoriteResolutionReceipts', 'favoriteResolutionTasks', 'favoriteReviewCandidateSets', 'favoriteSources', 'libraries', 'organizer', 'progress', 'reminders', 'reviews', 'works'] as const;
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
  getFavoriteParseArtifact(sourceId: FavoriteSourceId): Promise<FavoriteParseArtifactRecord | undefined>;
  getFavoriteResolutionTask(id: string): Promise<DurableTask | undefined>;
  getFavoriteBookmarkMutation(bookmarkId: string): Promise<FavoriteBookmarkMutation | undefined>;
  getFavoriteInventoryCheckpoint(): Promise<FavoriteInventoryCheckpoint | undefined>;
  getFavoriteInventoryMark(bookmarkId: string): Promise<FavoriteInventoryMark | undefined>;
  getFavoriteProviderRateCheckpoint(provider: FavoriteProviderRateCheckpoint['provider']): Promise<FavoriteProviderRateCheckpoint | undefined>;
  getFavoriteResolutionReceipt(id: string): Promise<FavoriteResolutionReceipt | undefined>;
  getFavoriteReviewCandidateSet(reviewId: ReviewId): Promise<FavoriteReviewCandidateSet | undefined>;
  findFavoriteSourceByReviewId(reviewId: ReviewId): Promise<FavoriteSource | undefined>;
  getLibrary(id: LibraryId): Promise<Library | undefined>;
  getOrganizerConfiguration(): Promise<OrganizerConfiguration | undefined>;
  getProgress(id: ProgressId): Promise<Progress | undefined>;
  findProgressByWorkId(workId: WorkId): Promise<Progress | undefined>;
  getReminder(id: ReminderId): Promise<Reminder | undefined>;
  getReview(id: ReviewId): Promise<Review | undefined>;
  getWork(id: WorkId): Promise<Work | undefined>;
  listAgendaEntries(query: AgendaEntryListQuery): Promise<readonly AgendaEntry[]>;
  listFavoriteSources(query: FavoriteSourcePageQuery): Promise<readonly FavoriteSource[]>;
  listReviews(query: ReviewListQuery): Promise<readonly Review[]>;
  listReviewsByWorkId(query: ReviewMatchListQuery): Promise<readonly Review[]>;
  listFavoriteSourcesByWorkId(query: ReviewMatchListQuery): Promise<readonly FavoriteSource[]>;
}

export interface StorageWritePort {
  putAgendaEntry(entry: AgendaEntry): Promise<void>;
  putFavoriteSource(source: FavoriteSource): Promise<void>;
  putFavoriteParseArtifact(record: FavoriteParseArtifactRecord): Promise<void>;
  putFavoriteResolutionTask(task: DurableTask): Promise<void>;
  putFavoriteBookmarkMutation(mutation: FavoriteBookmarkMutation): Promise<void>;
  putFavoriteInventoryCheckpoint(checkpoint: FavoriteInventoryCheckpoint): Promise<void>;
  putFavoriteInventoryMark(mark: FavoriteInventoryMark): Promise<void>;
  putFavoriteProviderRateCheckpoint(checkpoint: FavoriteProviderRateCheckpoint): Promise<void>;
  putFavoriteResolutionReceipt(receipt: FavoriteResolutionReceipt): Promise<void>;
  putFavoriteReviewCandidateSet(set: FavoriteReviewCandidateSet): Promise<void>;
  putLibrary(library: Library): Promise<void>;
  putOrganizerConfiguration(configuration: OrganizerConfiguration): Promise<void>;
  putProgress(progress: Progress): Promise<void>;
  putReminder(reminder: Reminder): Promise<void>;
  putReview(review: Review): Promise<void>;
  putWork(work: Work): Promise<void>;
}

export type StorageSession = StorageReadPort & StorageWritePort;

export interface StoragePort extends StorageSession {
  transaction<TResult>(stores: readonly PrivateStoreName[], operation: (session: StorageSession) => Promise<TResult>): Promise<TResult>;
}
