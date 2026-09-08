import { assertAgendaEntryListQuery, assertReviewMatchListQuery, assertWorkIdentityQuery } from '@tobirink/application';
import type { PrivateStoreName, StoragePort, StorageSession } from '@tobirink/application';
import {
  createAgendaEntry,
  createFavoriteSource,
  createLibrary,
  createOrganizerConfiguration,
  createProgress,
  createReminder,
  createReview,
  createWork,
} from '@tobirink/domain';
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
import { TobirinkDatabase } from './database';
import { createDexieFavoriteResolutionSession } from './favorite-resolution/dexie-favorite-resolution-session';
import { privateStoreTables } from './private-store-tables';

export class DexieStoragePort implements StoragePort {
  readonly database: TobirinkDatabase;

  constructor(databaseName = 'tobirink-private') {
    this.database = new TobirinkDatabase(databaseName);
  }

  private session(allowed?: ReadonlySet<PrivateStoreName>): StorageSession {
    const requireStore = (store: PrivateStoreName) => {
      if (allowed && !allowed.has(store)) throw new Error(`Store ${store} is outside the transaction scope.`);
    };
    return {
      ...createDexieFavoriteResolutionSession(this.database, requireStore),
      getFavoriteBookmarkMutation: async (bookmarkId) => { requireStore('favoriteBookmarkMutations'); return this.database.favoriteBookmarkMutations.get(bookmarkId); },
      getFavoriteInventoryCheckpoint: async () => { requireStore('favoriteInventoryCheckpoints'); return this.database.favoriteInventoryCheckpoints.get('favorite-inventory'); },
      getFavoriteInventoryMark: async (bookmarkId) => { requireStore('favoriteInventoryMarks'); return this.database.favoriteInventoryMarks.get(bookmarkId); },
      getFavoriteProviderRateCheckpoint: async (provider) => { requireStore('favoriteProviderRateCheckpoints'); return this.database.favoriteProviderRateCheckpoints.get(provider); },
      getFavoriteResolutionReceipt: async (id) => { requireStore('favoriteResolutionReceipts'); return this.database.favoriteResolutionReceipts.get(id); },
      getFavoriteReviewCandidateSet: async (reviewId) => { requireStore('favoriteReviewCandidateSets'); return this.database.favoriteReviewCandidateSets.get(reviewId); },
      getAgendaEntry: async (id: AgendaEntryId) => { requireStore('agenda'); const entry = await this.database.agenda.get(id); return entry && createAgendaEntry(entry); },
      getFavoriteSource: async (id: FavoriteSourceId) => { requireStore('favoriteSources'); const source = await this.database.favoriteSources.get(id); return source && createFavoriteSource(source); },
      findFavoriteSourceByReviewId: async (reviewId: ReviewId) => {
        requireStore('favoriteSources');
        const matches = await this.database.favoriteSources.where('reviewId').equals(reviewId).limit(2).toArray();
        if (matches.length > 1) throw new Error('A Review may belong to only one favorite source.');
        return matches[0] && createFavoriteSource(matches[0]);
      },
      getLibrary: async (id: LibraryId) => { requireStore('libraries'); const library = await this.database.libraries.get(id); return library && createLibrary(library.id, library.workIds); },
      getOrganizerConfiguration: async () => { requireStore('organizer'); const configuration = await this.database.organizer.get('organizer'); return configuration && createOrganizerConfiguration(configuration); },
      getProgress: async (id: ProgressId) => { requireStore('progress'); const progress = await this.database.progress.get(id); return progress && createProgress(progress); },
      findProgressByWorkId: async (workId: WorkId) => {
        requireStore('progress');
        const matches = await this.database.progress.where('workId').equals(workId).limit(2).toArray();
        if (matches.length > 1) throw new Error('A Work may have only one progress record.');
        return matches[0] && createProgress(matches[0]);
      },
      getReminder: async (id: ReminderId) => { requireStore('reminders'); const reminder = await this.database.reminders.get(id); return reminder && createReminder(reminder); },
      getReview: async (id: ReviewId) => { requireStore('reviews'); const review = await this.database.reviews.get(id); return review && createReview(review); },
      getWork: async (id: WorkId) => { requireStore('works'); const work = await this.database.works.get(id); return work && createWork(work); },
      listAgendaEntries: async (query) => {
        requireStore('agenda');
        assertAgendaEntryListQuery(query);
        return (await this.database.agenda.where('occursAt').between(query.from, query.to, true, false).limit(query.limit).toArray())
          .map(createAgendaEntry)
          .sort((left, right) => (left.occursAt ?? '').localeCompare(right.occursAt ?? '') || left.id.localeCompare(right.id));
      },
      listFavoriteSources: async ({ afterId, limit }) => {
        requireStore('favoriteSources');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Favorite source page limit must be an integer between 1 and 100.');
        const collection = afterId === undefined
          ? this.database.favoriteSources.orderBy('id')
          : this.database.favoriteSources.where('id').above(afterId);
        return (await collection.limit(limit).toArray()).map(createFavoriteSource);
      },
      listReviews: async ({ limit, status }) => {
        requireStore('reviews');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Review list limit must be an integer between 1 and 100.');
        return (await this.database.reviews.where('status').equals(status).limit(limit).toArray())
          .map(createReview)
          .sort((left, right) => left.id.localeCompare(right.id));
      },
      listReviewsByWorkId: async (query) => {
        requireStore('reviews');
        assertReviewMatchListQuery(query);
        return (await this.database.reviews.where('matchedWorkId').equals(query.workId).limit(query.limit).toArray())
          .map(createReview)
          .sort((left, right) => left.id.localeCompare(right.id));
      },
      listWorksByIdentityKey: async (query) => {
        requireStore('works');
        assertWorkIdentityQuery(query);
        const index = query.kind === 'favorite-alias' ? 'hydration.favoriteAliasKeys' : 'hydration.providerTitleKeys';
        return (await this.database.works.where(index).equals(query.key).limit(query.limit).toArray()).map(createWork);
      },
      listWorks: async ({ afterId, limit }) => {
        requireStore('works');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Work page limit must be between 1 and 100.');
        const collection = afterId === undefined ? this.database.works.orderBy('id') : this.database.works.where('id').above(afterId);
        return (await collection.limit(limit).toArray()).map(createWork);
      },
      listFavoriteSourcesByWorkId: async (query) => {
        requireStore('favoriteSources');
        assertReviewMatchListQuery(query);
        return (await this.database.favoriteSources.where('matchedWorkId').equals(query.workId).limit(query.limit).toArray())
          .map(createFavoriteSource);
      },
      putAgendaEntry: async (entry: AgendaEntry) => { requireStore('agenda'); await this.database.agenda.put(createAgendaEntry(entry)); },
      putFavoriteBookmarkMutation: async (mutation) => { requireStore('favoriteBookmarkMutations'); await this.database.favoriteBookmarkMutations.put(Object.freeze({ ...mutation })); },
      putFavoriteInventoryCheckpoint: async (checkpoint) => { requireStore('favoriteInventoryCheckpoints'); await this.database.favoriteInventoryCheckpoints.put(Object.freeze({ ...checkpoint })); },
      putFavoriteInventoryMark: async (mark) => { requireStore('favoriteInventoryMarks'); await this.database.favoriteInventoryMarks.put(Object.freeze({ ...mark })); },
      putFavoriteProviderRateCheckpoint: async (checkpoint) => { requireStore('favoriteProviderRateCheckpoints'); await this.database.favoriteProviderRateCheckpoints.put(Object.freeze({ ...checkpoint })); },
      putFavoriteResolutionReceipt: async (receipt) => { requireStore('favoriteResolutionReceipts'); await this.database.favoriteResolutionReceipts.put(Object.freeze({ ...receipt })); },
      putFavoriteReviewCandidateSet: async (set) => { requireStore('favoriteReviewCandidateSets'); await this.database.favoriteReviewCandidateSets.put(Object.freeze({ ...set, candidates: Object.freeze([...set.candidates]) })); },
      putFavoriteSource: async (source: FavoriteSource) => {
        requireStore('favoriteSources');
        const existing = source.reviewId === undefined ? undefined : await this.database.favoriteSources.where('reviewId').equals(source.reviewId).first();
        if (existing && existing.id !== source.id) throw new Error('A Review may belong to only one favorite source.');
        await this.database.favoriteSources.put(createFavoriteSource(source));
      },
      putLibrary: async (library: Library) => { requireStore('libraries'); await this.database.libraries.put(createLibrary(library.id, library.workIds)); },
      putOrganizerConfiguration: async (configuration: OrganizerConfiguration) => { requireStore('organizer'); await this.database.organizer.put(createOrganizerConfiguration(configuration)); },
      putProgress: async (progress: Progress) => { requireStore('progress'); await this.database.progress.put(createProgress(progress)); },
      putReminder: async (reminder: Reminder) => { requireStore('reminders'); await this.database.reminders.put(createReminder(reminder)); },
      putReview: async (review: Review) => { requireStore('reviews'); await this.database.reviews.put(createReview(review)); },
      putWork: async (work: Work) => { requireStore('works'); await this.database.works.put(createWork(work)); },
    };
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
  listWorksByIdentityKey: StoragePort['listWorksByIdentityKey'] = (query) => this.session().listWorksByIdentityKey(query);
  listWorks: StoragePort['listWorks'] = (query) => this.session().listWorks(query);
  listAgendaEntries: StoragePort['listAgendaEntries'] = (query) => this.session().listAgendaEntries(query);
  listFavoriteSources: StoragePort['listFavoriteSources'] = (query) => this.session().listFavoriteSources(query);
  listReviews: StoragePort['listReviews'] = (query) => this.session().listReviews(query);
  listReviewsByWorkId: StoragePort['listReviewsByWorkId'] = (query) => this.session().listReviewsByWorkId(query);
  listFavoriteSourcesByWorkId: StoragePort['listFavoriteSourcesByWorkId'] = (query) => this.session().listFavoriteSourcesByWorkId(query);
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
    if (stores.length === 0) throw new Error('A storage transaction requires at least one store.');
    const allowed = new Set(stores);
    return this.database.transaction('rw', privateStoreTables(this.database, stores), () => operation(this.session(allowed)));
  }

  close() {
    this.database.close();
  }

  async deleteDatabase() {
    await this.database.delete();
  }
}
