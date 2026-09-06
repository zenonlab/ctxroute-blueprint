import { z } from 'zod';
import { agendaEntryId, createAgendaEntry, workId } from '@tobirink/domain';
import type { AgendaEntry, WorkId } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';

export const PUBLIC_RELEASE_AVAILABILITY = ['confirmed', 'estimated', 'official'] as const;
const publicReleaseIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,127}$/u);
const publicReleaseEntrySchema = z.strictObject({
  availability: z.enum(PUBLIC_RELEASE_AVAILABILITY),
  label: z.string().min(1).max(160),
  occursAt: z.iso.datetime(),
  releaseId: publicReleaseIdSchema,
  workId: publicReleaseIdSchema,
});

export const publicReleaseSnapshotSchema = z.strictObject({
  entries: z.array(publicReleaseEntrySchema).max(200),
  generatedAt: z.iso.datetime(),
  revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
}).superRefine((snapshot, context) => {
  if (new Set(snapshot.entries.map((entry) => entry.releaseId)).size !== snapshot.entries.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate public release identity', path: ['entries'] });
  }
});

export type PublicReleaseSnapshotInput = z.input<typeof publicReleaseSnapshotSchema>;
export type PublicReleaseSnapshot = z.output<typeof publicReleaseSnapshotSchema>;

export interface PublicReleaseCachePort {
  load(): Promise<PublicReleaseSnapshotInput | undefined>;
  save(snapshot: PublicReleaseSnapshot): Promise<void>;
}

export function parsePublicReleaseSnapshot(value: PublicReleaseSnapshotInput): PublicReleaseSnapshot {
  const snapshot = publicReleaseSnapshotSchema.parse(value);
  const entries = [...snapshot.entries].sort((left, right) => left.occursAt.localeCompare(right.occursAt) || left.releaseId.localeCompare(right.releaseId));
  return { ...snapshot, entries };
}

export async function hydrateAgendaFromPublicReleaseCache(
  storage: StoragePort,
  cache: PublicReleaseCachePort,
): Promise<{ entries: readonly AgendaEntry[]; generatedAt?: string; missingWorkIds: readonly WorkId[]; state: 'empty' | 'hydrated' }> {
  const input = await cache.load();
  if (input === undefined) return { entries: [], missingWorkIds: [], state: 'empty' };
  const snapshot = parsePublicReleaseSnapshot(input);
  const missingWorkIds: WorkId[] = [];
  const agendaEntries: AgendaEntry[] = [];
  await storage.transaction(['agenda', 'works'], async (session) => {
    for (const entry of snapshot.entries) {
      const linkedWorkId = workId(entry.workId);
      if (!await session.getWork(linkedWorkId)) {
        missingWorkIds.push(linkedWorkId);
        continue;
      }
      const agendaEntry = createAgendaEntry({
        availability: entry.availability,
        id: agendaEntryId(`agenda_${entry.releaseId}`),
        occursAt: entry.occursAt,
        releaseLabel: entry.label,
        workId: linkedWorkId,
      });
      await session.putAgendaEntry(agendaEntry);
      agendaEntries.push(agendaEntry);
    }
  });
  return { entries: Object.freeze(agendaEntries), generatedAt: snapshot.generatedAt, missingWorkIds: Object.freeze(missingWorkIds), state: 'hydrated' };
}
