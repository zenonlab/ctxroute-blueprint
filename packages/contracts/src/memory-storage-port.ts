import type { PrivateStoreName, StoragePort, StorageSession } from '@tobirink/application';
import type {
  AgendaEntry,
  AgendaEntryId,
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
  libraries: RecordMap<Library>;
  progress: RecordMap<Progress>;
  reminders: RecordMap<Reminder>;
  reviews: RecordMap<Review>;
  works: RecordMap<Work>;
}

function emptyState(): MemoryState {
  return { agenda: new Map(), libraries: new Map(), progress: new Map(), reminders: new Map(), reviews: new Map(), works: new Map() };
}

function cloneState(state: MemoryState): MemoryState {
  return {
    agenda: new Map(state.agenda),
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
    getLibrary: async (id: LibraryId) => { requireStore('libraries'); return state.libraries.get(id); },
    getProgress: async (id: ProgressId) => { requireStore('progress'); return state.progress.get(id); },
    getReminder: async (id: ReminderId) => { requireStore('reminders'); return state.reminders.get(id); },
    getReview: async (id: ReviewId) => { requireStore('reviews'); return state.reviews.get(id); },
    getWork: async (id: WorkId) => { requireStore('works'); return state.works.get(id); },
    putAgendaEntry: async (entry: AgendaEntry) => { requireStore('agenda'); state.agenda.set(entry.id, entry); },
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
  getLibrary: StoragePort['getLibrary'] = (id) => this.session().getLibrary(id);
  getProgress: StoragePort['getProgress'] = (id) => this.session().getProgress(id);
  getReminder: StoragePort['getReminder'] = (id) => this.session().getReminder(id);
  getReview: StoragePort['getReview'] = (id) => this.session().getReview(id);
  getWork: StoragePort['getWork'] = (id) => this.session().getWork(id);
  putAgendaEntry: StoragePort['putAgendaEntry'] = (entry) => this.session().putAgendaEntry(entry);
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
