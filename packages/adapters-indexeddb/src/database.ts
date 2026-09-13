import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { AgendaEntry, FavoriteSource, Library, LocalAgendaEvent, LocalNotificationDelivery, LocalReleaseEvidence, OrganizerConfiguration, Progress, PublicReleaseEvent, Reminder, Review, Work } from '@tobirink/domain';
import { publicReleaseEventSchema } from '@tobirink/application';
import type { DurableTask, FavoriteBookmarkMutation, FavoriteInventoryCheckpoint, FavoriteInventoryMark, FavoriteParseArtifactRecord, FavoriteProviderRateCheckpoint, FavoriteResolutionReceipt, FavoriteReviewCandidateSet } from '@tobirink/application';
import { migrateVersion1To2 } from './migrations/v2';
import type { ProviderIdentityRecoveryRecord } from './recovery/provider-identity-recovery-state-adapter';
import type { PublicReleaseStagingRecord, PublicReleaseSyncRecord } from './releases/dexie-public-release-fallback-store';

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
  readonly privateRecoveryReceipts!: Table<{ committedAt: string; id: string }, string>;
  readonly publicReleaseEvents!: Table<PublicReleaseEvent, string>;
  readonly localReleaseEvidence!: Table<LocalReleaseEvidence, string>;
  readonly localAgendaEvents!: Table<LocalAgendaEvent, string>;
  readonly localAgendaProjectionState!: Table<{ id: 'active'; revision: string }, 'active'>;
  readonly localNotificationDeliveries!: Table<LocalNotificationDelivery, string>;
  readonly publicReleaseSyncState!: Table<PublicReleaseSyncRecord, string>;
  readonly publicReleaseStagingEvents!: Table<PublicReleaseStagingRecord, string>;

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
    this.version(13).stores({
      works: '&id, mediaKind, preferredTitle, *hydration.favoriteAliasKeys, *hydration.providerTitleKeys, *hydration.candidate.genres, hydration.candidate.editorialStatus, hydration.candidate.format, hydration.candidate.startYear, hydration.candidate.popularity.value',
    });
    this.version(14).stores({ privateRecoveryReceipts: '&id' });
    this.version(15).stores({
      publicReleaseEvents: '&id, provider, providerWorkId, [provider+providerWorkId], releaseKind, state, expiresAt',
      publicReleaseSyncState: '&id, generation, checkedAt',
      localReleaseEvidence: '&id, publicReleaseId, workId, observedAt',
      localAgendaEvents: '&id, workId, availability',
      localNotificationDeliveries: '&id, agendaEventId, deduplicationKey, status, availableAt',
    });
    this.version(16).stores({
      publicReleaseEvents: '&id, provider, providerWorkId, [provider+providerWorkId], releaseKind, state, expiresAt',
    }).upgrade(async (transaction) => {
      await transaction.table<PublicReleaseEvent>('publicReleaseEvents').toCollection().modify((event) => {
        Object.assign(event, publicReleaseEventSchema.parse(event));
      });
    });
    this.version(17).stores({
      publicReleaseStagingEvents: '&id, generation',
    });
    this.version(18).stores({
      localAgendaEvents: '&id, workId, occurrence.value, [occurrence.kind+occurrence.value], availability',
      localAgendaProjectionState: '&id',
      localReleaseEvidence: '&id, publicReleaseId, workId, observedAt, [workId+occurrence.value]',
    });
  }
}
