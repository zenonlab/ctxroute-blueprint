import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AgendaEntry, FavoriteSource, Library, OrganizerConfiguration, Progress, Reminder, Review, Work } from '@tobirink/domain';
import type { DurableTask, FavoriteBookmarkMutation, FavoriteInventoryCheckpoint, FavoriteInventoryMark, FavoriteParseArtifactRecord, FavoriteProviderRateCheckpoint, FavoriteResolutionReceipt, FavoriteReviewCandidateSet } from '@tobirink/application';
import { migrateVersion1To2 } from './migrations/v2';
import type { ProviderIdentityRecoveryRecord } from './recovery/provider-identity-recovery-state-adapter';

export class TobirinkDatabase extends Dexie {
  readonly agenda!: Table<AgendaEntry, string>;
  readonly favoriteSources!: Table<FavoriteSource, string>;
  readonly favoriteArtifacts!: Table<FavoriteParseArtifactRecord, string>;
  readonly favoriteBookmarkMutations!: Table<FavoriteBookmarkMutation, string>;
  readonly favoriteInventoryCheckpoints!: Table<FavoriteInventoryCheckpoint, string>;
  readonly favoriteInventoryMarks!: Table<FavoriteInventoryMark, string>;
  readonly favoriteProviderRateCheckpoints!: Table<FavoriteProviderRateCheckpoint, string>;
  readonly favoriteResolutionReceipts!: Table<FavoriteResolutionReceipt, string>;
  readonly favoriteReviewCandidateSets!: Table<FavoriteReviewCandidateSet, string>;
  readonly favoriteResolutionTasks!: Table<DurableTask, string>;
  readonly libraries!: Table<Library, string>;
  readonly organizer!: Table<OrganizerConfiguration, 'organizer'>;
  readonly progress!: Table<Progress, string>;
  readonly reminders!: Table<Reminder, string>;
  readonly reviews!: Table<Review, string>;
  readonly works!: Table<Work, string>;
  readonly providerIdentityRecovery!: Table<ProviderIdentityRecoveryRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      agenda: '&id, workId, occursAt, availability',
      libraries: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(2).stores({
      agenda: '&id, workId, occursAt, availability',
      libraries: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status',
      works: '&id, mediaKind, preferredTitle',
    }).upgrade(migrateVersion1To2);
    this.version(3).stores({
      agenda: '&id, workId, occursAt, availability',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
      libraries: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(4).stores({
      agenda: '&id, workId, occursAt, availability',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
      libraries: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status, matchedWorkId',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(5).stores({
      agenda: '&id, workId, occursAt, availability',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
      libraries: '&id',
      organizer: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status, matchedWorkId',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(6).stores({
      agenda: '&id, workId, occursAt, availability',
      favoriteArtifacts: '&sourceId, reviewId, recordedAt, artifact.semanticFingerprint',
      favoriteResolutionTasks: '&id, &idempotencyKey, kind, lane, state, availableAt, [kind+lane+state+availableAt]',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
      libraries: '&id',
      organizer: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status, matchedWorkId',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(7).stores({
      agenda: '&id, workId, occursAt, availability',
      favoriteArtifacts: '&sourceId, reviewId, recordedAt, artifact.semanticFingerprint',
      favoriteBookmarkMutations: '&bookmarkId, sequence, kind',
      favoriteInventoryCheckpoints: '&id, status, sessionId',
      favoriteInventoryMarks: '&bookmarkId, sessionId',
      favoriteResolutionTasks: '&id, &idempotencyKey, kind, lane, state, availableAt, [kind+lane+state+availableAt]',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
      libraries: '&id',
      organizer: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status, matchedWorkId',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(8).stores({
      agenda: '&id, workId, occursAt, availability',
      favoriteArtifacts: '&sourceId, reviewId, recordedAt, artifact.semanticFingerprint',
      favoriteBookmarkMutations: '&bookmarkId, sequence, kind',
      favoriteInventoryCheckpoints: '&id, status, sessionId',
      favoriteInventoryMarks: '&bookmarkId, sessionId',
      favoriteProviderRateCheckpoints: '&provider, nextAllowedAt',
      favoriteResolutionReceipts: '&id, &idempotencyKey, sourceId, completedAt',
      favoriteResolutionTasks: '&id, &idempotencyKey, kind, lane, state, availableAt, [kind+lane+state+availableAt], [state+claimedAt]',
      favoriteReviewCandidateSets: '&reviewId, recordedAt',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
      libraries: '&id',
      organizer: '&id',
      progress: '&id, workId, kind',
      reminders: '&id, agendaEntryId, channel',
      reviews: '&id, status, matchedWorkId',
      works: '&id, mediaKind, preferredTitle',
    });
    this.version(9).stores({
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt, matchedWorkId',
    });
    this.version(10).stores({
      works: '&id, mediaKind, preferredTitle, *hydration.favoriteAliasKeys, *hydration.providerTitleKeys',
    });
    this.version(11).stores({ providerIdentityRecovery: '&id' });
    this.version(12).stores({
      reviews: '&id, status, matchedWorkId, [status+availableAt+id]',
      favoriteSources: '&id, &bookmarkId, reviewId, importedAt, matchedWorkId, presence, [presence+resolution.kind]',
    }).upgrade(async (transaction) => {
      await transaction.table<Review>('reviews').toCollection().modify((review) => {
        if (review.reason !== undefined && review.status === 'pending' && review.availableAt === undefined) review.availableAt = '1970-01-01T00:00:00.000Z';
      });
    });
  }
}
