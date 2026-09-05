import {
  createAgendaEntry,
  createFavoriteSource,
  createLibrary,
  createProgress,
  createReminder,
  createReview,
  createWork,
} from '@tobirink/domain';
import type { TobirinkDatabase } from '../database';

export interface IntegrityReport {
  checkedRecords: number;
  schemaVersion: number;
}

export async function verifyDatabaseIntegrity(database: TobirinkDatabase): Promise<IntegrityReport> {
  const [agenda, favoriteSources, libraries, progress, reminders, reviews, works] = await Promise.all([
    database.agenda.toArray(),
    database.favoriteSources.toArray(),
    database.libraries.toArray(),
    database.progress.toArray(),
    database.reminders.toArray(),
    database.reviews.toArray(),
    database.works.toArray(),
  ]);
  const validAgenda = agenda.map(createAgendaEntry);
  const validFavoriteSources = favoriteSources.map(createFavoriteSource);
  const validLibraries = libraries.map((library) => createLibrary(library.id, library.workIds));
  const validProgress = progress.map(createProgress);
  const validReminders = reminders.map(createReminder);
  const validReviews = reviews.map(createReview);
  const validWorks = works.map(createWork);
  const workIds = new Set(validWorks.map((work) => work.id));
  const agendaIds = new Set(validAgenda.map((entry) => entry.id));
  const reviewIds = new Set(validReviews.map((review) => review.id));

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
    if (!reviewIds.has(source.reviewId)) throw new Error(`Favorite source ${source.id} references a missing review.`);
  }

  return {
    checkedRecords: agenda.length + favoriteSources.length + libraries.length + progress.length + reminders.length + reviews.length + works.length,
    schemaVersion: database.verno,
  };
}
