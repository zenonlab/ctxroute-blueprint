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
import { createFavoriteParseArtifactRecord, parseFavoriteResolutionTaskPayload, restoreDurableTask } from '@tobirink/application';
import type { TobirinkDatabase } from '../database';

export interface IntegrityReport {
  checkedRecords: number;
  schemaVersion: number;
}

export async function verifyDatabaseIntegrity(database: TobirinkDatabase): Promise<IntegrityReport> {
  const [agenda, favoriteArtifacts, favoriteBookmarkMutations, favoriteInventoryCheckpoints, favoriteInventoryMarks, favoriteProviderRateCheckpoints, favoriteResolutionReceipts, favoriteResolutionTasks, favoriteReviewCandidateSets, favoriteSources, libraries, organizer, progress, reminders, reviews, works] = await Promise.all([
    database.agenda.toArray(),
    database.favoriteArtifacts.toArray(),
    database.favoriteBookmarkMutations.toArray(),
    database.favoriteInventoryCheckpoints.toArray(),
    database.favoriteInventoryMarks.toArray(),
    database.favoriteProviderRateCheckpoints.toArray(),
    database.favoriteResolutionReceipts.toArray(),
    database.favoriteResolutionTasks.toArray(),
    database.favoriteReviewCandidateSets.toArray(),
    database.favoriteSources.toArray(),
    database.libraries.toArray(),
    database.organizer.toArray(),
    database.progress.toArray(),
    database.reminders.toArray(),
    database.reviews.toArray(),
    database.works.toArray(),
  ]);
  const validAgenda = agenda.map(createAgendaEntry);
  const validFavoriteArtifacts = favoriteArtifacts.map(createFavoriteParseArtifactRecord);
  const validFavoriteResolutionTasks = favoriteResolutionTasks.map(restoreDurableTask);
  const validFavoriteSources = favoriteSources.map(createFavoriteSource);
  const validLibraries = libraries.map((library) => createLibrary(library.id, library.workIds));
  if (organizer.length > 1) throw new Error('Organizer store contains more than one configuration.');
  for (const configuration of organizer) createOrganizerConfiguration(configuration);
  const validProgress = progress.map(createProgress);
  const validReminders = reminders.map(createReminder);
  const validReviews = reviews.map(createReview);
  const validWorks = works.map(createWork);
  const workIds = new Set(validWorks.map((work) => work.id));
  const agendaIds = new Set(validAgenda.map((entry) => entry.id));
  const reviewIds = new Set(validReviews.map((review) => review.id));
  const sourceIds = new Set(validFavoriteSources.map((source) => source.id));

  if (favoriteInventoryCheckpoints.length > 1) throw new Error('Favorite inventory contains more than one checkpoint.');
  for (const checkpoint of favoriteProviderRateCheckpoints) {
    if (!['anilist', 'kitsu-anime', 'kitsu-manga', 'mangaupdates'].includes(checkpoint.provider) || !Number.isSafeInteger(checkpoint.nextAllowedAt) || checkpoint.nextAllowedAt < 0) throw new Error('Favorite provider rate checkpoint is invalid.');
  }

  for (const library of validLibraries) {
    if (library.workIds.some((id) => !workIds.has(id))) throw new Error(`Library ${library.id} references a missing work.`);
  }
  for (const item of [...validProgress, ...validAgenda]) {
    if (!workIds.has(item.workId)) throw new Error(`Record ${item.id} references a missing work.`);
  }
  for (const review of validReviews) {
    if (review.matchedWorkId !== undefined && !workIds.has(review.matchedWorkId)) throw new Error(`Review ${review.id} references a missing work.`);
  }
  for (const reminder of validReminders) {
    if (!agendaIds.has(reminder.agendaEntryId)) throw new Error(`Reminder ${reminder.id} references a missing agenda entry.`);
  }
  for (const source of validFavoriteSources) {
    if (source.matchedWorkId !== undefined && !workIds.has(source.matchedWorkId)) throw new Error('Favorite source references a missing work.');
    if (source.reviewId !== undefined && !reviewIds.has(source.reviewId)) throw new Error(`Favorite source ${source.id} references a missing review.`);
  }
  for (const record of validFavoriteArtifacts) {
    if (!sourceIds.has(record.sourceId) || (record.reviewId !== undefined && !reviewIds.has(record.reviewId))) throw new Error(`Favorite artifact ${record.sourceId} references missing private data.`);
  }
  for (const task of validFavoriteResolutionTasks) {
    if (task.kind !== 'favorite-resolution') throw new Error(`Unexpected favorite resolution task kind ${task.kind}.`);
    const payload = parseFavoriteResolutionTaskPayload(task.payload);
    const artifact = validFavoriteArtifacts.find((record) => record.sourceId === payload.sourceId);
    if (!sourceIds.has(payload.sourceId) || (payload.reviewId !== undefined && !reviewIds.has(payload.reviewId)) || artifact?.artifact.semanticFingerprint !== payload.semanticFingerprint) throw new Error(`Favorite resolution task ${task.id} references stale private data.`);
  }
  for (const receipt of favoriteResolutionReceipts) {
    if (!sourceIds.has(receipt.sourceId) || !receipt.idempotencyKey.trim() || !receipt.effectDigest.trim()) throw new Error(`Favorite resolution receipt ${receipt.id} is invalid.`);
  }
  for (const set of favoriteReviewCandidateSets) {
    if (!reviewIds.has(set.reviewId) || set.candidates.length > 6 || !set.digest.trim()) throw new Error(`Favorite Review candidate set ${set.reviewId} is invalid.`);
  }

  return {
    checkedRecords: agenda.length + favoriteArtifacts.length + favoriteBookmarkMutations.length + favoriteInventoryCheckpoints.length + favoriteInventoryMarks.length + favoriteProviderRateCheckpoints.length + favoriteResolutionReceipts.length + favoriteResolutionTasks.length + favoriteReviewCandidateSets.length + favoriteSources.length + libraries.length + organizer.length + progress.length + reminders.length + reviews.length + works.length,
    schemaVersion: database.verno,
  };
}
