import {
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
  workId,
} from '@tobirink/domain';
import type { AgendaEntry, FavoriteSource, Library, OrganizerConfiguration, Progress, Reminder, Review, Work } from '@tobirink/domain';
import { z } from 'zod';
import { favoriteResolutionResultSchema, favoriteResolutionVersionsSchema } from '../favorites/resolution-result-schema';
import { providerCandidateSchema } from '../favorites/provider-search-checkpoint';
import { organizerConfigurationSchema, parseOrganizerConfiguration } from './organizer-export-schema';

export interface PrivateSnapshot {
  agenda: readonly AgendaEntry[];
  favoriteSources: readonly FavoriteSource[];
  libraries: readonly Library[];
  organizer?: OrganizerConfiguration;
  progress: readonly Progress[];
  reminders: readonly Reminder[];
  reviews: readonly Review[];
  works: readonly Work[];
}

export type PrivateExportV1 = Omit<PrivateSnapshot, 'favoriteSources' | 'organizer'> & {
  exportedAt: string;
  format: 'tobirink-private-export';
  version: 1;
};

export type PrivateExportV2 = Omit<PrivateSnapshot, 'organizer'> & {
  exportedAt: string;
  format: 'tobirink-private-export';
  version: 2;
};

export interface PrivateExportV3 extends PrivateSnapshot {
  exportedAt: string;
  format: 'tobirink-private-export';
  version: 3;
}

export interface PrivateExportV4 extends PrivateSnapshot {
  exportedAt: string;
  format: 'tobirink-private-export';
  version: 4;
}

export interface RecoveryStorePort {
  readSnapshot(): Promise<PrivateSnapshot>;
  replaceSnapshot(snapshot: PrivateSnapshot): Promise<void>;
}

const workSchema = z.strictObject({
  hydration: z.strictObject({ candidate: providerCandidateSchema, favoriteAliasKeys: z.array(z.string().min(1).max(2048)).max(64), hydratedAt: z.string(), matcherVersion: z.string().min(1).max(100), providerTitleKeys: z.array(z.string().min(1).max(2048)).max(16) }).optional(),
  externalReferences: z.array(z.strictObject({ externalId: z.string(), provider: z.string() })),
  id: z.string(), mediaKind: z.enum(['anime', 'manga']), preferredTitle: z.string(),
});
const librarySchema = z.strictObject({ id: z.string(), workIds: z.array(z.string()) });
const progressSchema = z.strictObject({ id: z.string(), kind: z.enum(['chapter', 'episode']), maximum: z.number().optional(), value: z.number(), workId: z.string() });
const reviewSchema = z.strictObject({ decisionOrigin: z.enum(['human', 'automatic']).optional(), reason: z.enum(['AMBIGUOUS', 'NOT_FOUND']).optional(), id: z.string(), matchedWorkId: z.string().optional(), sourceLabel: z.string(), status: z.enum(['pending', 'resolved', 'no-match']), title: z.string() });
const agendaSchema = z.strictObject({ availability: z.enum(['confirmed', 'estimated', 'official', 'unavailable']), id: z.string(), occursAt: z.string().optional(), releaseLabel: z.string(), workId: z.string() });
const reminderSchema = z.strictObject({ agendaEntryId: z.string(), channel: z.enum(['badge', 'native']), enabled: z.boolean(), id: z.string(), leadMinutes: z.number() });
const favoriteSourceSchema = z.strictObject({
  bookmarkId: z.string(), folderPath: z.array(z.string()), id: z.string(), importedAt: z.string(), order: z.number(),
  presence: z.enum(['observed', 'detached']).optional().default('observed'),
  matchedWorkId: z.string().optional(),
  resolution: favoriteResolutionResultSchema.optional(),
  resolutionVersions: favoriteResolutionVersionsSchema.optional(),
  reviewId: z.string().optional(), title: z.string(), url: z.url().refine((value) => /^https?:\/\//iu.test(value)),
});
const legacySnapshotSchema = z.strictObject({
  agenda: z.array(agendaSchema), libraries: z.array(librarySchema), progress: z.array(progressSchema),
  reminders: z.array(reminderSchema), reviews: z.array(reviewSchema), works: z.array(workSchema),
});
const versionTwoSnapshotSchema = legacySnapshotSchema.extend({ favoriteSources: z.array(favoriteSourceSchema) });
const snapshotSchema = versionTwoSnapshotSchema.extend({ organizer: organizerConfigurationSchema.optional() });
const exportV1Schema = legacySnapshotSchema.extend({ exportedAt: z.string(), format: z.literal('tobirink-private-export'), version: z.literal(1) });
const exportV2Schema = versionTwoSnapshotSchema.extend({ exportedAt: z.string(), format: z.literal('tobirink-private-export'), version: z.literal(2) });
const exportV3Schema = snapshotSchema.extend({ exportedAt: z.string(), format: z.literal('tobirink-private-export'), version: z.literal(3) });
const exportV4Schema = snapshotSchema.extend({ exportedAt: z.string(), format: z.literal('tobirink-private-export'), version: z.literal(4) });
const exportSchema = z.discriminatedUnion('version', [exportV1Schema, exportV2Schema, exportV3Schema, exportV4Schema]);

function canonicalDateTime(value: string, label: string): void {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} must be a canonical ISO date-time.`);
}

function materializeSnapshot(input: z.infer<typeof snapshotSchema>): PrivateSnapshot {
  const base: Omit<PrivateSnapshot, 'organizer'> = {
    agenda: input.agenda.map((item) => {
      const entry: AgendaEntry = { availability: item.availability, id: agendaEntryId(item.id), releaseLabel: item.releaseLabel, workId: workId(item.workId) };
      if (item.occursAt !== undefined) entry.occursAt = item.occursAt;
      return createAgendaEntry(entry);
    }),
    favoriteSources: input.favoriteSources.map((item) => {
      const source: FavoriteSource = {
        bookmarkId: item.bookmarkId, folderPath: item.folderPath, id: favoriteSourceId(item.id),
        importedAt: item.importedAt, order: item.order, presence: item.presence, title: item.title, url: item.url,
      };
      if (item.reviewId !== undefined) source.reviewId = reviewId(item.reviewId);
      if (item.matchedWorkId !== undefined) source.matchedWorkId = workId(item.matchedWorkId);
      if (item.resolution !== undefined) source.resolution = item.resolution;
      if (item.resolutionVersions !== undefined) source.resolutionVersions = item.resolutionVersions;
      return createFavoriteSource(source);
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
      if (item.reason !== undefined) review.reason = item.reason;
      if (item.decisionOrigin !== undefined) review.decisionOrigin = item.decisionOrigin;
      return createReview(review);
    }),
    works: input.works.map(({ hydration, ...item }) => {
      const base = { ...item, id: workId(item.id) };
      return createWork(hydration === undefined ? base : { ...base, hydration });
    }),
  };
  const organizer = input.organizer === undefined ? undefined : parseOrganizerConfiguration(input.organizer);
  const snapshot: PrivateSnapshot = organizer === undefined ? base : { ...base, organizer };
  const works = new Set(snapshot.works.map((work) => work.id));
  const agenda = new Set(snapshot.agenda.map((entry) => entry.id));
  const reviews = new Set(snapshot.reviews.map((review) => review.id));
  if (snapshot.libraries.some((library) => library.workIds.some((id) => !works.has(id)))) throw new Error('A library references a missing work.');
  if ([...snapshot.progress, ...snapshot.agenda].some((item) => !works.has(item.workId))) throw new Error('A record references a missing work.');
  if (snapshot.reviews.some((review) => review.matchedWorkId !== undefined && !works.has(review.matchedWorkId))) throw new Error('A review references a missing work.');
  if (snapshot.reminders.some((reminder) => !agenda.has(reminder.agendaEntryId))) throw new Error('A reminder references a missing agenda entry.');
  if (snapshot.favoriteSources.some((source) => source.reviewId !== undefined && !reviews.has(source.reviewId))) throw new Error('A favorite source references a missing review.');
  if (snapshot.favoriteSources.some((source) => source.matchedWorkId !== undefined && !works.has(source.matchedWorkId))) throw new Error('A favorite source references a missing work.');
  return Object.freeze(snapshot);
}

export function validatePrivateSnapshot(value: PrivateSnapshot): PrivateSnapshot {
  return materializeSnapshot(snapshotSchema.parse(value));
}

export function validatePrivateExport(serialized: string): PrivateExportV4 {
  const input = exportSchema.parse(JSON.parse(serialized));
  canonicalDateTime(input.exportedAt, 'export.exportedAt');
  const snapshotInput = {
    ...input,
    favoriteSources: input.version === 1 ? [] : input.favoriteSources,
    organizer: input.version === 3 || input.version === 4 ? input.organizer : undefined,
  };
  return Object.freeze({ ...materializeSnapshot(snapshotInput), exportedAt: input.exportedAt, format: input.format, version: 4 });
}

export async function createPrivateExport(storage: RecoveryStorePort, exportedAt: string): Promise<PrivateExportV4> {
  canonicalDateTime(exportedAt, 'exportedAt');
  return Object.freeze({ ...validatePrivateSnapshot(await storage.readSnapshot()), exportedAt, format: 'tobirink-private-export', version: 4 });
}

export async function importPrivateExport(serialized: string, storage: RecoveryStorePort, confirmation: string): Promise<void> {
  const validated = validatePrivateExport(serialized);
  if (confirmation !== 'replace-private-state') throw new Error('Replacing private state requires explicit confirmation.');
  const base: Omit<PrivateSnapshot, 'organizer'> = {
    agenda: validated.agenda,
    favoriteSources: validated.favoriteSources,
    libraries: validated.libraries,
    progress: validated.progress,
    reminders: validated.reminders,
    reviews: validated.reviews,
    works: validated.works,
  };
  await storage.replaceSnapshot(validated.organizer === undefined ? base : { ...base, organizer: validated.organizer });
}
