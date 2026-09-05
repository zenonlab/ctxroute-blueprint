import { verifyStoragePortContract } from '@tobirink/contracts';
import {
  agendaEntryId,
  createAgendaEntry,
  createReminder,
  createReview,
  reminderId,
  reviewId,
  workId,
} from '@tobirink/domain';
import { DexieStoragePort } from '../src';

const storage = new DexieStoragePort(`tobirink-contract-${Date.now()}`);

try {
  await verifyStoragePortContract(() => storage);
  const work = workId('work_browser');
  const review = createReview({ id: reviewId('review_browser'), sourceLabel: 'Fixture', status: 'pending', title: 'Browser contract' });
  const agenda = createAgendaEntry({ availability: 'unavailable', id: agendaEntryId('agenda_browser'), releaseLabel: 'Unknown release', workId: work });
  const reminder = createReminder({ agendaEntryId: agenda.id, channel: 'badge', enabled: true, id: reminderId('reminder_browser'), leadMinutes: 0 });
  await storage.transaction(['reviews', 'agenda', 'reminders'], async (session) => {
    await session.putReview(review);
    await session.putAgendaEntry(agenda);
    await session.putReminder(reminder);
  });
  if (!(await storage.getReview(review.id)) || !(await storage.getAgendaEntry(agenda.id)) || !(await storage.getReminder(reminder.id))) {
    throw new Error('Review, agenda or reminder did not round-trip through IndexedDB.');
  }
  document.body.dataset.status = 'passed';
  document.body.textContent = 'IndexedDB StoragePort contract passed';
} catch (error) {
  document.body.dataset.status = 'failed';
  document.body.textContent = error instanceof Error ? error.message : String(error);
} finally {
  await storage.deleteDatabase();
}
