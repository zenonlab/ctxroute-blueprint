import { describe, expect, it } from 'vitest';
import {
  DomainInvariantError,
  addWork,
  agendaEntryId,
  createAgendaEntry,
  createFavoriteSource,
  createLibrary,
  createProgress,
  createReminder,
  createReview,
  createWork,
  favoriteSourceId,
  libraryId,
  progressId,
  reminderId,
  reviewId,
  updateProgress,
  workId,
} from './index';

const frierenId = workId('work_frieren');

describe('stable domain identities', () => {
  it('accepts owned identifiers and rejects URLs or provider identifiers', () => {
    expect(frierenId).toBe('work_frieren');
    expect(() => workId('https://example.test/work/42')).toThrowError(DomainInvariantError);
    expect(() => workId('mal-52991')).toThrowError(/stable work identifier/);
  });
});

describe('Work and Library invariants', () => {
  it('normalizes immutable work metadata and rejects duplicate provider references', () => {
    const work = createWork({
      externalReferences: [{ externalId: ' 52991 ', provider: ' MAL ' }],
      id: frierenId,
      mediaKind: 'anime',
      preferredTitle: ' Frieren ',
    });
    expect(work.preferredTitle).toBe('Frieren');
    expect(work.externalReferences).toEqual([{ externalId: '52991', provider: 'MAL' }]);
    expect(Object.isFrozen(work.externalReferences)).toBe(true);

    expect(() => createWork({
      ...work,
      externalReferences: [
        { externalId: '52991', provider: 'MAL' },
        { externalId: '52991', provider: 'MAL' },
      ],
    })).toThrowError(/only once/);
    expect(() => createWork({ ...work, preferredTitle: 'a'.repeat(8 * 1024 + 1) })).toThrowError(/preferredTitle exceeds/u);
  });

  it('keeps library identity stable and membership unique', () => {
    const empty = createLibrary(libraryId('library_local1'));
    const populated = addWork(empty, frierenId);
    expect(populated.id).toBe(empty.id);
    expect(populated.workIds).toEqual([frierenId]);
    expect(() => addWork(populated, frierenId)).toThrowError(/only once/);
  });
});

describe('FavoriteSource invariant', () => {
  it('preserves a private bookmark source without using it as Work identity', () => {
    const source = createFavoriteSource({
      bookmarkId: ' bookmark-42 ',
      folderPath: [' Lectures ', ' Manga '],
      id: favoriteSourceId('source_bookmark42'),
      importedAt: '2026-09-05T20:00:00.000Z',
      order: 3,
      reviewId: reviewId('review_bookmark42'),
      title: ' Frieren chapitre 140 ',
      url: 'https://reader.example/frieren/140',
    });
    expect(source).toMatchObject({ bookmarkId: 'bookmark-42', folderPath: ['Lectures', 'Manga'], order: 3, title: 'Frieren chapitre 140' });
    expect(Object.isFrozen(source.folderPath)).toBe(true);
    expect(() => createFavoriteSource({ ...source, url: 'chrome://bookmarks' })).toThrowError(/HTTP/);
    expect(() => createFavoriteSource({ ...source, order: 1.5 })).toThrowError(/integer/);
  });
});

describe('Progress invariant', () => {
  it('bounds known progress and requires explicit regression confirmation', () => {
    const progress = createProgress({ id: progressId('progress_frieren'), kind: 'episode', maximum: 28, value: 12, workId: frierenId });
    expect(updateProgress(progress, 13).value).toBe(13);
    expect(() => updateProgress(progress, 8)).toThrowError(/explicit confirmation/);
    expect(updateProgress(progress, 8, true).value).toBe(8);
    expect(() => updateProgress(progress, 29)).toThrowError(/known maximum/);
  });
});

describe('Review, Agenda and Reminder invariants', () => {
  it('binds a matched work only to a resolved Review', () => {
    expect(createReview({ id: reviewId('review_frieren'), matchedWorkId: frierenId, sourceLabel: 'Favori', status: 'resolved', title: 'Frieren' }).status).toBe('resolved');
    expect(() => createReview({ id: reviewId('review_pending'), matchedWorkId: frierenId, sourceLabel: 'Favori', status: 'pending', title: 'Frieren' })).toThrowError(/resolved Review/);
  });

  it('requires canonical dates except for unavailable agenda entries', () => {
    const scheduled = createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_frieren'), occursAt: '2026-09-10T18:00:00.000Z', releaseLabel: 'Épisode 29', workId: frierenId });
    expect(scheduled.occursAt).toBe('2026-09-10T18:00:00.000Z');
    expect(createAgendaEntry({ availability: 'unavailable', id: agendaEntryId('agenda_unknown'), releaseLabel: 'Épisode 30', workId: frierenId }).occursAt).toBeUndefined();
    expect(() => createAgendaEntry({ availability: 'estimated', id: agendaEntryId('agenda_invalid'), releaseLabel: 'Épisode 30', workId: frierenId })).toThrowError(/requires one/);
  });

  it('keeps reminders attached to agenda identity with an integral lead time', () => {
    const reminder = createReminder({ agendaEntryId: agendaEntryId('agenda_frieren'), channel: 'native', enabled: true, id: reminderId('reminder_frieren'), leadMinutes: 30 });
    expect(reminder.leadMinutes).toBe(30);
    expect(() => createReminder({ ...reminder, leadMinutes: 2.5 })).toThrowError(/integer/);
  });
});
