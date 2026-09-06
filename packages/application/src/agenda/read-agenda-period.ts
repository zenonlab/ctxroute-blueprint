import type { AgendaEntry, FavoriteSource, Work, WorkId } from '@tobirink/domain';
import type { StorageReadPort } from '../ports/storage-port';
import { agendaEntryListLimit, reviewMatchListLimit } from '../ports/storage-port';

export interface AgendaPeriodItem {
  entry: AgendaEntry & { occursAt: string };
  source?: FavoriteSource;
  work: Work;
}

export interface AgendaPeriodSnapshot {
  items: readonly AgendaPeriodItem[];
  missingWorkIds: readonly WorkId[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSources(left: FavoriteSource, right: FavoriteSource): number {
  return compareText(left.folderPath.join('\u0000'), right.folderPath.join('\u0000'))
    || left.order - right.order
    || compareText(left.id, right.id);
}

async function preferredSource(storage: StorageReadPort, workId: WorkId): Promise<FavoriteSource | undefined> {
  const reviews = await storage.listReviewsByWorkId({ limit: reviewMatchListLimit, workId });
  const sources = await Promise.all(reviews.map((review) => storage.findFavoriteSourceByReviewId(review.id)));
  return sources.filter((source): source is FavoriteSource => source !== undefined).sort(compareSources)[0];
}

export async function readAgendaPeriod(
  storage: StorageReadPort,
  period: { from: string; to: string },
): Promise<AgendaPeriodSnapshot> {
  const entries = await storage.listAgendaEntries({ ...period, limit: agendaEntryListLimit });
  const sources = new Map<WorkId, Promise<FavoriteSource | undefined>>();
  const records = await Promise.all(entries.map(async (entry) => {
    const work = await storage.getWork(entry.workId);
    if (!work) return { entry, source: undefined, work };
    const pendingSource = sources.get(work.id) ?? preferredSource(storage, work.id);
    sources.set(work.id, pendingSource);
    return { entry, source: await pendingSource, work };
  }));
  return {
    items: records.flatMap(({ entry, source, work }) => {
      if (!work || !entry.occursAt) return [];
      const item = { entry: { ...entry, occursAt: entry.occursAt }, work };
      return [source ? { ...item, source } : item];
    }),
    missingWorkIds: records.filter(({ work }) => !work).map(({ entry }) => entry.workId),
  };
}
