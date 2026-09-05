import {
  agendaEntryId,
  createAgendaEntry,
  createLibrary,
  createProgress,
  createReminder,
  createReview,
  createWork,
  libraryId,
  progressId,
  reminderId,
  reviewId,
  workId,
} from '@tobirink/domain';
import type { AgendaEntry, Library, Progress, Reminder, Review, Work } from '@tobirink/domain';
import { z } from 'zod';

export interface PrivateSnapshot {
  agenda: readonly AgendaEntry[];
  libraries: readonly Library[];
  progress: readonly Progress[];
  reminders: readonly Reminder[];
  reviews: readonly Review[];
  works: readonly Work[];
}

export interface PrivateExportV1 extends PrivateSnapshot {
  exportedAt: string;
  format: 'tobirink-private-export';
  version: 1;
}

export interface RecoveryStorePort {
  readSnapshot(): Promise<PrivateSnapshot>;
  replaceSnapshot(snapshot: PrivateSnapshot): Promise<void>;
}

const workSchema = z.strictObject({
  externalReferences: z.array(z.strictObject({ externalId: z.string(), provider: z.string() })),
  id: z.string(), mediaKind: z.enum(['anime', 'manga']), preferredTitle: z.string(),
});
const librarySchema = z.strictObject({ id: z.string(), workIds: z.array(z.string()) });
const progressSchema = z.strictObject({ id: z.string(), kind: z.enum(['chapter', 'episode']), maximum: z.number().optional(), value: z.number(), workId: z.string() });
const reviewSchema = z.strictObject({ id: z.string(), matchedWorkId: z.string().optional(), sourceLabel: z.string(), status: z.enum(['pending', 'resolved', 'no-match']), title: z.string() });
const agendaSchema = z.strictObject({ availability: z.enum(['confirmed', 'estimated', 'official', 'unavailable']), id: z.string(), occursAt: z.string().optional(), releaseLabel: z.string(), workId: z.string() });
const reminderSchema = z.strictObject({ agendaEntryId: z.string(), channel: z.enum(['badge', 'native']), enabled: z.boolean(), id: z.string(), leadMinutes: z.number() });
const snapshotSchema = z.strictObject({
  agenda: z.array(agendaSchema), libraries: z.array(librarySchema), progress: z.array(progressSchema),
  reminders: z.array(reminderSchema), reviews: z.array(reviewSchema), works: z.array(workSchema),
});
const exportSchema = snapshotSchema.extend({ exportedAt: z.string(), format: z.literal('tobirink-private-export'), version: z.literal(1) });

function canonicalDateTime(value: string, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} must be a canonical ISO date-time.`);
}

function materializeSnapshot(input: z.infer<typeof snapshotSchema>): PrivateSnapshot {
  const snapshot = {
    agenda: input.agenda.map((item) => {
      const entry: AgendaEntry = { availability: item.availability, id: agendaEntryId(item.id), releaseLabel: item.releaseLabel, workId: workId(item.workId) };
      if (item.occursAt !== undefined) entry.occursAt = item.occursAt;
      return createAgendaEntry(entry);
    }),
    libraries: input.libraries.map((item) => createLibrary(libraryId(item.id), item.workIds.map(workId))),
    progress: input.progress.map((item) => {
      const progress: Progress = { id: progressId(item.id), kind: item.kind, value: item.value, workId: workId(item.workId) };
      if (item.maximum !== undefined) progress.maximum = item.maximum;
      return createProgress(progress);
    }),
    reminders: input.reminders.map((item) => createReminder({ ...item, agendaEntryId: agendaEntryId(item.agendaEntryId), id: reminderId(item.id) })),
    reviews: input.reviews.map((item) => {
      const review: Review = { id: reviewId(item.id), sourceLabel: item.sourceLabel, status: item.status, title: item.title };
      if (item.matchedWorkId !== undefined) review.matchedWorkId = workId(item.matchedWorkId);
      return createReview(review);
    }),
    works: input.works.map((item) => createWork({ ...item, id: workId(item.id) })),
  } satisfies PrivateSnapshot;
  const works = new Set(snapshot.works.map((work) => work.id));
  const agenda = new Set(snapshot.agenda.map((entry) => entry.id));
  if (snapshot.libraries.some((library) => library.workIds.some((id) => !works.has(id)))) throw new Error('A library references a missing work.');
  if ([...snapshot.progress, ...snapshot.agenda].some((item) => !works.has(item.workId))) throw new Error('A record references a missing work.');
  if (snapshot.reviews.some((review) => review.matchedWorkId !== undefined && !works.has(review.matchedWorkId))) throw new Error('A review references a missing work.');
  if (snapshot.reminders.some((reminder) => !agenda.has(reminder.agendaEntryId))) throw new Error('A reminder references a missing agenda entry.');
  return Object.freeze(snapshot);
}

export function validatePrivateSnapshot(value: PrivateSnapshot): PrivateSnapshot {
  return materializeSnapshot(snapshotSchema.parse(value));
}

export function validatePrivateExport(serialized: string): PrivateExportV1 {
  const input = exportSchema.parse(JSON.parse(serialized));
  canonicalDateTime(input.exportedAt, 'export.exportedAt');
  return Object.freeze({ ...materializeSnapshot(input), exportedAt: input.exportedAt, format: input.format, version: input.version });
}

export async function createPrivateExport(storage: RecoveryStorePort, exportedAt: string): Promise<PrivateExportV1> {
  canonicalDateTime(exportedAt, 'exportedAt');
  return Object.freeze({ ...validatePrivateSnapshot(await storage.readSnapshot()), exportedAt, format: 'tobirink-private-export', version: 1 });
}

export async function importPrivateExport(serialized: string, storage: RecoveryStorePort, confirmation: string): Promise<void> {
  const validated = validatePrivateExport(serialized);
  if (confirmation !== 'replace-private-state') throw new Error('Replacing private state requires explicit confirmation.');
  await storage.replaceSnapshot({
    agenda: validated.agenda,
    libraries: validated.libraries,
    progress: validated.progress,
    reminders: validated.reminders,
    reviews: validated.reviews,
    works: validated.works,
  });
}
