import { assertAgendaEntryListQuery, assertReviewMatchListQuery } from '@tobirink/application';
import type { DurableTask, FavoriteBookmarkMutation, FavoriteInventoryCheckpoint, FavoriteInventoryMark, FavoriteParseArtifactRecord, FavoriteProviderRateCheckpoint, FavoriteResolutionReceipt, FavoriteReviewCandidateSet, PrivateStoreName, StoragePort, StorageSession } from '@tobirink/application';
import { createOrganizerConfiguration } from '@tobirink/domain';
import type {
  AgendaEntry,
  AgendaEntryId,
  FavoriteSource,
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
  Work,
  WorkId,
} from '@tobirink/domain';
import { createMemoryFavoriteResolutionSession } from './memory-favorite-resolution-storage';

type RecordMap<T> = Map<string, T>;

interface MemoryState {
  agenda: RecordMap<AgendaEntry>;
  favoriteSources: RecordMap<FavoriteSource>;
  favoriteArtifacts: RecordMap<FavoriteParseArtifactRecord>;
  favoriteBookmarkMutations: RecordMap<FavoriteBookmarkMutation>;
  favoriteInventoryCheckpoints: RecordMap<FavoriteInventoryCheckpoint>;
  favoriteInventoryMarks: RecordMap<FavoriteInventoryMark>;
  favoriteProviderRateCheckpoints: RecordMap<FavoriteProviderRateCheckpoint>;
  favoriteResolutionReceipts: RecordMap<FavoriteResolutionReceipt>;
  favoriteReviewCandidateSets: RecordMap<FavoriteReviewCandidateSet>;
  favoriteResolutionTasks: RecordMap<DurableTask>;
  libraries: RecordMap<Library>;
  organizer?: OrganizerConfiguration;
  progress: RecordMap<Progress>;
  reminders: RecordMap<Reminder>;
  reviews: RecordMap<Review>;
  works: RecordMap<Work>;
}

function emptyState(): MemoryState {
  return { agenda: new Map(), favoriteArtifacts: new Map(), favoriteBookmarkMutations: new Map(), favoriteInventoryCheckpoints: new Map(), favoriteInventoryMarks: new Map(), favoriteProviderRateCheckpoints: new Map(), favoriteResolutionReceipts: new Map(), favoriteResolutionTasks: new Map(), favoriteReviewCandidateSets: new Map(), favoriteSources: new Map(), libraries: new Map(), progress: new Map(), reminders: new Map(), reviews: new Map(), works: new Map() };
}

function cloneState(state: MemoryState): MemoryState {
  const cloned: MemoryState = {
    agenda: new Map(state.agenda),
    favoriteArtifacts: new Map(state.favoriteArtifacts),
    favoriteBookmarkMutations: new Map(state.favoriteBookmarkMutations),
    favoriteInventoryCheckpoints: new Map(state.favoriteInventoryCheckpoints),
    favoriteInventoryMarks: new Map(state.favoriteInventoryMarks),
    favoriteProviderRateCheckpoints: new Map(state.favoriteProviderRateCheckpoints),
    favoriteResolutionReceipts: new Map(state.favoriteResolutionReceipts),
    favoriteReviewCandidateSets: new Map(state.favoriteReviewCandidateSets),
    favoriteResolutionTasks: new Map(state.favoriteResolutionTasks),
    favoriteSources: new Map(state.favoriteSources),
    libraries: new Map(state.libraries),
    progress: new Map(state.progress),
    reminders: new Map(state.reminders),
    reviews: new Map(state.reviews),
    works: new Map(state.works),
  };
  if (state.organizer !== undefined) cloned.organizer = state.organizer;
  return cloned;
}

function scopedSession(state: MemoryState, allowed?: ReadonlySet<PrivateStoreName>): StorageSession {
  const requireStore = (store: PrivateStoreName) => {
    if (allowed && !allowed.has(store)) throw new Error(`Store ${store} is outside the transaction scope.`);
  };
  return {
    ...createMemoryFavoriteResolutionSession(state, requireStore),
    getFavoriteBookmarkMutation: async (bookmarkId) => { requireStore('favoriteBookmarkMutations'); return state.favoriteBookmarkMutations.get(bookmarkId); },
    getFavoriteInventoryCheckpoint: async () => { requireStore('favoriteInventoryCheckpoints'); return state.favoriteInventoryCheckpoints.get('favorite-inventory'); },
    getFavoriteInventoryMark: async (bookmarkId) => { requireStore('favoriteInventoryMarks'); return state.favoriteInventoryMarks.get(bookmarkId); },
    getFavoriteProviderRateCheckpoint: async (provider) => { requireStore('favoriteProviderRateCheckpoints'); return state.favoriteProviderRateCheckpoints.get(provider); },
    getFavoriteResolutionReceipt: async (id) => { requireStore('favoriteResolutionReceipts'); return state.favoriteResolutionReceipts.get(id); },
    getFavoriteReviewCandidateSet: async (reviewId) => { requireStore('favoriteReviewCandidateSets'); return state.favoriteReviewCandidateSets.get(reviewId); },
    getAgendaEntry: async (id: AgendaEntryId) => { requireStore('agenda'); return state.agenda.get(id); },
    getFavoriteSource: async (id: FavoriteSourceId) => { requireStore('favoriteSources'); return state.favoriteSources.get(id); },
    findFavoriteSourceByReviewId: async (reviewId: ReviewId) => {
      requireStore('favoriteSources');
      const matches = [...state.favoriteSources.values()].filter((source) => source.reviewId === reviewId);
      if (matches.length > 1) throw new Error('A Review may belong to only one favorite source.');
      return matches[0];
    },
    getLibrary: async (id: LibraryId) => { requireStore('libraries'); return state.libraries.get(id); },
    getOrganizerConfiguration: async () => { requireStore('organizer'); return state.organizer; },
    getProgress: async (id: ProgressId) => { requireStore('progress'); return state.progress.get(id); },
    findProgressByWorkId: async (workId: WorkId) => {
      requireStore('progress');
      const matches = [...state.progress.values()].filter((progress) => progress.workId === workId);
      if (matches.length > 1) throw new Error('A Work may have only one progress record.');
      return matches[0];
    },
    getReminder: async (id: ReminderId) => { requireStore('reminders'); return state.reminders.get(id); },
    getReview: async (id: ReviewId) => { requireStore('reviews'); return state.reviews.get(id); },
    getWork: async (id: WorkId) => { requireStore('works'); return state.works.get(id); },
    listAgendaEntries: async (query) => {
      requireStore('agenda');
      assertAgendaEntryListQuery(query);
      return [...state.agenda.values()]
        .filter((entry) => entry.occursAt !== undefined && entry.occursAt >= query.from && entry.occursAt < query.to)
        .sort((left, right) => (left.occursAt ?? '').localeCompare(right.occursAt ?? '') || left.id.localeCompare(right.id))
        .slice(0, query.limit);
    },
    listFavoriteSources: async ({ afterId, limit }) => {
      requireStore('favoriteSources');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Favorite source page limit must be an integer between 1 and 100.');
      return [...state.favoriteSources.values()]
        .filter((source) => afterId === undefined || source.id > afterId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit);
    },
    listReviews: async ({ limit, status }) => {
      requireStore('reviews');
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Review list limit must be an integer between 1 and 100.');
      return [...state.reviews.values()]
        .filter((review) => review.status === status)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit);
    },
    listReviewsByWorkId: async (query) => {
      requireStore('reviews');
      assertReviewMatchListQuery(query);
      return [...state.reviews.values()]
        .filter((review) => review.matchedWorkId === query.workId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, query.limit);
    },
    putAgendaEntry: async (entry: AgendaEntry) => { requireStore('agenda'); state.agenda.set(entry.id, entry); },
    putFavoriteBookmarkMutation: async (mutation) => { requireStore('favoriteBookmarkMutations'); state.favoriteBookmarkMutations.set(mutation.bookmarkId, mutation); },
    putFavoriteInventoryCheckpoint: async (checkpoint) => { requireStore('favoriteInventoryCheckpoints'); state.favoriteInventoryCheckpoints.set(checkpoint.id, checkpoint); },
    putFavoriteInventoryMark: async (mark) => { requireStore('favoriteInventoryMarks'); state.favoriteInventoryMarks.set(mark.bookmarkId, mark); },
    putFavoriteProviderRateCheckpoint: async (checkpoint) => { requireStore('favoriteProviderRateCheckpoints'); state.favoriteProviderRateCheckpoints.set(checkpoint.provider, checkpoint); },
    putFavoriteResolutionReceipt: async (receipt) => { requireStore('favoriteResolutionReceipts'); state.favoriteResolutionReceipts.set(receipt.id, receipt); },
    putFavoriteReviewCandidateSet: async (set) => { requireStore('favoriteReviewCandidateSets'); state.favoriteReviewCandidateSets.set(set.reviewId, set); },
    putFavoriteSource: async (source: FavoriteSource) => {
      requireStore('favoriteSources');
      const duplicate = [...state.favoriteSources.values()].find((record) => record.bookmarkId === source.bookmarkId && record.id !== source.id);
      if (duplicate) throw new Error('A bookmark may belong to only one favorite source.');
      const duplicateReview = [...state.favoriteSources.values()].find((record) => record.reviewId === source.reviewId && record.id !== source.id);
      if (duplicateReview) throw new Error('A Review may belong to only one favorite source.');
      state.favoriteSources.set(source.id, source);
    },
    putLibrary: async (library: Library) => { requireStore('libraries'); state.libraries.set(library.id, library); },
    putOrganizerConfiguration: async (configuration: OrganizerConfiguration) => { requireStore('organizer'); state.organizer = createOrganizerConfiguration(configuration); },
    putProgress: async (progress: Progress) => { requireStore('progress'); state.progress.set(progress.id, progress); },
    putReminder: async (reminder: Reminder) => { requireStore('reminders'); state.reminders.set(reminder.id, reminder); },
    putReview: async (review: Review) => { requireStore('reviews'); state.reviews.set(review.id, review); },
    putWork: async (work: Work) => { requireStore('works'); state.works.set(work.id, work); },
  };
}

export class MemoryStoragePort implements StoragePort {
  private state = emptyState();

  private session() {
    return scopedSession(this.state);
  }

  getAgendaEntry: StoragePort['getAgendaEntry'] = (id) => this.session().getAgendaEntry(id);
  getFavoriteParseArtifact: StoragePort['getFavoriteParseArtifact'] = (sourceId) => this.session().getFavoriteParseArtifact(sourceId);
  getFavoriteResolutionTask: StoragePort['getFavoriteResolutionTask'] = (id) => this.session().getFavoriteResolutionTask(id);
  getFavoriteBookmarkMutation: StoragePort['getFavoriteBookmarkMutation'] = (bookmarkId) => this.session().getFavoriteBookmarkMutation(bookmarkId);
  getFavoriteInventoryCheckpoint: StoragePort['getFavoriteInventoryCheckpoint'] = () => this.session().getFavoriteInventoryCheckpoint();
  getFavoriteInventoryMark: StoragePort['getFavoriteInventoryMark'] = (bookmarkId) => this.session().getFavoriteInventoryMark(bookmarkId);
  getFavoriteProviderRateCheckpoint: StoragePort['getFavoriteProviderRateCheckpoint'] = (provider) => this.session().getFavoriteProviderRateCheckpoint(provider);
  getFavoriteResolutionReceipt: StoragePort['getFavoriteResolutionReceipt'] = (id) => this.session().getFavoriteResolutionReceipt(id);
  getFavoriteReviewCandidateSet: StoragePort['getFavoriteReviewCandidateSet'] = (reviewId) => this.session().getFavoriteReviewCandidateSet(reviewId);
  getFavoriteSource: StoragePort['getFavoriteSource'] = (id) => this.session().getFavoriteSource(id);
  findFavoriteSourceByReviewId: StoragePort['findFavoriteSourceByReviewId'] = (reviewId) => this.session().findFavoriteSourceByReviewId(reviewId);
  getLibrary: StoragePort['getLibrary'] = (id) => this.session().getLibrary(id);
  getOrganizerConfiguration: StoragePort['getOrganizerConfiguration'] = () => this.session().getOrganizerConfiguration();
  getProgress: StoragePort['getProgress'] = (id) => this.session().getProgress(id);
  findProgressByWorkId: StoragePort['findProgressByWorkId'] = (workId) => this.session().findProgressByWorkId(workId);
  getReminder: StoragePort['getReminder'] = (id) => this.session().getReminder(id);
  getReview: StoragePort['getReview'] = (id) => this.session().getReview(id);
  getWork: StoragePort['getWork'] = (id) => this.session().getWork(id);
  listAgendaEntries: StoragePort['listAgendaEntries'] = (query) => this.session().listAgendaEntries(query);
  listFavoriteSources: StoragePort['listFavoriteSources'] = (query) => this.session().listFavoriteSources(query);
  listReviews: StoragePort['listReviews'] = (query) => this.session().listReviews(query);
  listReviewsByWorkId: StoragePort['listReviewsByWorkId'] = (query) => this.session().listReviewsByWorkId(query);
  putAgendaEntry: StoragePort['putAgendaEntry'] = (entry) => this.session().putAgendaEntry(entry);
  putFavoriteParseArtifact: StoragePort['putFavoriteParseArtifact'] = (record) => this.session().putFavoriteParseArtifact(record);
  putFavoriteResolutionTask: StoragePort['putFavoriteResolutionTask'] = (task) => this.session().putFavoriteResolutionTask(task);
  putFavoriteBookmarkMutation: StoragePort['putFavoriteBookmarkMutation'] = (mutation) => this.session().putFavoriteBookmarkMutation(mutation);
  putFavoriteInventoryCheckpoint: StoragePort['putFavoriteInventoryCheckpoint'] = (checkpoint) => this.session().putFavoriteInventoryCheckpoint(checkpoint);
  putFavoriteInventoryMark: StoragePort['putFavoriteInventoryMark'] = (mark) => this.session().putFavoriteInventoryMark(mark);
  putFavoriteProviderRateCheckpoint: StoragePort['putFavoriteProviderRateCheckpoint'] = (checkpoint) => this.session().putFavoriteProviderRateCheckpoint(checkpoint);
  putFavoriteResolutionReceipt: StoragePort['putFavoriteResolutionReceipt'] = (receipt) => this.session().putFavoriteResolutionReceipt(receipt);
  putFavoriteReviewCandidateSet: StoragePort['putFavoriteReviewCandidateSet'] = (set) => this.session().putFavoriteReviewCandidateSet(set);
  putFavoriteSource: StoragePort['putFavoriteSource'] = (source) => this.session().putFavoriteSource(source);
  putLibrary: StoragePort['putLibrary'] = (library) => this.session().putLibrary(library);
  putOrganizerConfiguration: StoragePort['putOrganizerConfiguration'] = (configuration) => this.session().putOrganizerConfiguration(configuration);
  putProgress: StoragePort['putProgress'] = (progress) => this.session().putProgress(progress);
  putReminder: StoragePort['putReminder'] = (reminder) => this.session().putReminder(reminder);
  putReview: StoragePort['putReview'] = (review) => this.session().putReview(review);
  putWork: StoragePort['putWork'] = (work) => this.session().putWork(work);

  async transaction<TResult>(stores: readonly PrivateStoreName[], operation: (session: StorageSession) => Promise<TResult>): Promise<TResult> {
    const draft = cloneState(this.state);
    const result = await operation(scopedSession(draft, new Set(stores)));
    this.state = draft;
    return result;
  }
}
