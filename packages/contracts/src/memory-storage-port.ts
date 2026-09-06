import { assertAgendaEntryListQuery } from '@tobirink/application';
import type { PrivateStoreName, StoragePort, StorageSession } from '@tobirink/application';
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

type RecordMap<T> = Map<string, T>;

interface MemoryState {
  agenda: RecordMap<AgendaEntry>;
  favoriteSources: RecordMap<FavoriteSource>;
  libraries: RecordMap<Library>;
  progress: RecordMap<Progress>;
  reminders: RecordMap<Reminder>;
  reviews: RecordMap<Review>;
  works: RecordMap<Work>;
}

function emptyState(): MemoryState {
  return { agenda: new Map(), favoriteSources: new Map(), libraries: new Map(), progress: new Map(), reminders: new Map(), reviews: new Map(), works: new Map() };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    agenda: new Map(state.agenda),
    favoriteSources: new Map(state.favoriteSources),
    libraries: new Map(state.libraries),
    progress: new Map(state.progress),
    reminders: new Map(state.reminders),
    reviews: new Map(state.reviews),
    works: new Map(state.works),
  };
}

function scopedSession(state: MemoryState, allowed?: ReadonlySet<PrivateStoreName>): StorageSession {
  const requireStore = (store: PrivateStoreName) => {
    if (allowed && !allowed.has(store)) throw new Error(`Store ${store} is outside the transaction scope.`);
  };
  return {
    getAgendaEntry: async (id: AgendaEntryId) => { requireStore('agenda'); return state.agenda.get(id); },
    getFavoriteSource: async (id: FavoriteSourceId) => { requireStore('favoriteSources'); return state.favoriteSources.get(id); },
    findFavoriteSourceByReviewId: async (reviewId: ReviewId) => {
      requireStore('favoriteSources');
      const matches = [...state.favoriteSources.values()].filter((source) => source.reviewId === reviewId);
      if (matches.length > 1) throw new Error('A Review may belong to only one favorite source.');
      return matches[0];
    },
    getLibrary: async (id: LibraryId) => { requireStore('libraries'); return state.libraries.get(id); },
    getProgress: async (id: ProgressId) => { requireStore('progress'); return state.progress.get(id); },
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
    putAgendaEntry: async (entry: AgendaEntry) => { requireStore('agenda'); state.agenda.set(entry.id, entry); },
    putFavoriteSource: async (source: FavoriteSource) => {
      requireStore('favoriteSources');
      const duplicate = [...state.favoriteSources.values()].find((record) => record.bookmarkId === source.bookmarkId && record.id !== source.id);
      if (duplicate) throw new Error('A bookmark may belong to only one favorite source.');
      const duplicateReview = [...state.favoriteSources.values()].find((record) => record.reviewId === source.reviewId && record.id !== source.id);
      if (duplicateReview) throw new Error('A Review may belong to only one favorite source.');
      state.favoriteSources.set(source.id, source);
    },
    putLibrary: async (library: Library) => { requireStore('libraries'); state.libraries.set(library.id, library); },
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
  getFavoriteSource: StoragePort['getFavoriteSource'] = (id) => this.session().getFavoriteSource(id);
  findFavoriteSourceByReviewId: StoragePort['findFavoriteSourceByReviewId'] = (reviewId) => this.session().findFavoriteSourceByReviewId(reviewId);
  getLibrary: StoragePort['getLibrary'] = (id) => this.session().getLibrary(id);
  getProgress: StoragePort['getProgress'] = (id) => this.session().getProgress(id);
  getReminder: StoragePort['getReminder'] = (id) => this.session().getReminder(id);
  getReview: StoragePort['getReview'] = (id) => this.session().getReview(id);
  getWork: StoragePort['getWork'] = (id) => this.session().getWork(id);
  listAgendaEntries: StoragePort['listAgendaEntries'] = (query) => this.session().listAgendaEntries(query);
  listFavoriteSources: StoragePort['listFavoriteSources'] = (query) => this.session().listFavoriteSources(query);
  listReviews: StoragePort['listReviews'] = (query) => this.session().listReviews(query);
  putAgendaEntry: StoragePort['putAgendaEntry'] = (entry) => this.session().putAgendaEntry(entry);
  putFavoriteSource: StoragePort['putFavoriteSource'] = (source) => this.session().putFavoriteSource(source);
  putLibrary: StoragePort['putLibrary'] = (library) => this.session().putLibrary(library);
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
