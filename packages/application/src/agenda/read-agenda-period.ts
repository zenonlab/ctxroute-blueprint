import type { AgendaEntry, Work, WorkId } from '@tobirink/domain';
import type { StorageReadPort } from '../ports/storage-port';
import { agendaEntryListLimit } from '../ports/storage-port';

export interface AgendaPeriodItem {
  entry: AgendaEntry & { occursAt: string };
  work: Work;
}

export interface AgendaPeriodSnapshot {
  items: readonly AgendaPeriodItem[];
  missingWorkIds: readonly WorkId[];
}

export async function readAgendaPeriod(
  storage: StorageReadPort,
  period: { from: string; to: string },
): Promise<AgendaPeriodSnapshot> {
  const entries = await storage.listAgendaEntries({ ...period, limit: agendaEntryListLimit });
  const records = await Promise.all(entries.map(async (entry) => ({ entry, work: await storage.getWork(entry.workId) })));
  return {
    items: records.flatMap(({ entry, work }) => work && entry.occursAt ? [{ entry: { ...entry, occursAt: entry.occursAt }, work }] : []),
    missingWorkIds: records.filter(({ work }) => !work).map(({ entry }) => entry.workId),
  };
}
