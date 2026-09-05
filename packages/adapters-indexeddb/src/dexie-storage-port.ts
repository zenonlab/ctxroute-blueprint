import type { PrivateStoreName, StoragePort, StorageSession } from '@tobirink/application';
import {
  createAgendaEntry,
  createLibrary,
  createProgress,
  createReminder,
  createReview,
  createWork,
} from '@tobirink/domain';
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
import type { Table } from 'dexie';
import { TobirinkDatabase } from './database';

export class DexieStoragePort implements StoragePort {
  readonly database: TobirinkDatabase;

  constructor(databaseName = 'tobirink-private') {
    this.database = new TobirinkDatabase(databaseName);
  }

  private tables(stores: readonly PrivateStoreName[]): Table[] {
    const tables = {
      agenda: this.database.agenda,
      libraries: this.database.libraries,
      progress: this.database.progress,
      reminders: this.database.reminders,
      reviews: this.database.reviews,
      works: this.database.works,
    } satisfies Record<PrivateStoreName, Table>;
    return [...new Set(stores)].map((store) => tables[store]);
  }

  private session(allowed?: ReadonlySet<PrivateStoreName>): StorageSession {
    const requireStore = (store: PrivateStoreName) => {
      if (allowed && !allowed.has(store)) throw new Error(`Store ${store} is outside the transaction scope.`);
    };
    return {
      getAgendaEntry: async (id: AgendaEntryId) => { requireStore('agenda'); const entry = await this.database.agenda.get(id); return entry && createAgendaEntry(entry); },
      getLibrary: async (id: LibraryId) => { requireStore('libraries'); const library = await this.database.libraries.get(id); return library && createLibrary(library.id, library.workIds); },
      getProgress: async (id: ProgressId) => { requireStore('progress'); const progress = await this.database.progress.get(id); return progress && createProgress(progress); },
      getReminder: async (id: ReminderId) => { requireStore('reminders'); const reminder = await this.database.reminders.get(id); return reminder && createReminder(reminder); },
      getReview: async (id: ReviewId) => { requireStore('reviews'); const review = await this.database.reviews.get(id); return review && createReview(review); },
      getWork: async (id: WorkId) => { requireStore('works'); const work = await this.database.works.get(id); return work && createWork(work); },
      putAgendaEntry: async (entry: AgendaEntry) => { requireStore('agenda'); await this.database.agenda.put(createAgendaEntry(entry)); },
      putLibrary: async (library: Library) => { requireStore('libraries'); await this.database.libraries.put(createLibrary(library.id, library.workIds)); },
      putProgress: async (progress: Progress) => { requireStore('progress'); await this.database.progress.put(createProgress(progress)); },
      putReminder: async (reminder: Reminder) => { requireStore('reminders'); await this.database.reminders.put(createReminder(reminder)); },
      putReview: async (review: Review) => { requireStore('reviews'); await this.database.reviews.put(createReview(review)); },
      putWork: async (work: Work) => { requireStore('works'); await this.database.works.put(createWork(work)); },
    };
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
    if (stores.length === 0) throw new Error('A storage transaction requires at least one store.');
    const allowed = new Set(stores);
    return this.database.transaction('rw', this.tables(stores), () => operation(this.session(allowed)));
  }

  close() {
    this.database.close();
  }

  async deleteDatabase() {
    await this.database.delete();
  }
}
