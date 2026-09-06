import { readAgendaPeriod, readReviewQueue } from '@tobirink/application';
import type { StoragePort } from '@tobirink/application';
import { libraryId, workId } from '@tobirink/domain';
import type { FavoriteSource, Work, WorkId } from '@tobirink/domain';
import type { WebAgendaPeriod, WebBootstrapSnapshot, WebLibraryPage, WebRequest, WebReviewSnapshot } from '@tobirink/contracts/web-bridge';
import { readLocalReviewCandidateSnapshot, writeLocalReviewDecision } from './local-review-runtime';
import type { WebBridgeRequestHandler, WebBridgeValue } from './web-bridge-runtime';

const primaryLibraryId = libraryId('library_primary');
const libraryScanLimit = 500;
const projectionByteLimit = 60 * 1024;

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().trim();
}

function localMidnight(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function projectionFits(serialized: string): boolean {
  return new TextEncoder().encode(serialized).byteLength <= projectionByteLimit;
}

async function preferredSource(storage: StoragePort, id: WorkId): Promise<FavoriteSource | undefined> {
  const reviews = await storage.listReviewsByWorkId({ limit: 100, workId: id });
  const sources = await Promise.all(reviews.map((review) => storage.findFavoriteSourceByReviewId(review.id)));
  return sources.filter((source): source is FavoriteSource => source !== undefined)
    .sort((left, right) => left.folderPath.join('\u0000').localeCompare(right.folderPath.join('\u0000')) || left.order - right.order || left.id.localeCompare(right.id))[0];
}

async function mapLibraryItem(storage: StoragePort, work: Work) {
  const [progress, source] = await Promise.all([storage.findProgressByWorkId(work.id), preferredSource(storage, work.id)]);
  const base = { mediaKind: work.mediaKind, title: work.preferredTitle, workId: work.id };
  const progressLabel = progress
    ? `${progress.kind === 'episode' ? 'Épisode' : 'Chapitre'} ${progress.value}${progress.maximum === undefined ? '' : `/${progress.maximum}`}`
    : undefined;
  if (progressLabel && source) return { ...base, progressLabel, sourceUrl: source.url };
  if (progressLabel) return { ...base, progressLabel };
  if (source) return { ...base, sourceUrl: source.url };
  return base;
}

function mapReviewSnapshot(snapshot: Awaited<ReturnType<typeof readLocalReviewCandidateSnapshot>>): WebReviewSnapshot {
  return {
    candidates: snapshot.candidates.map((candidate) => ({ candidateId: candidate.candidateId, mediaKind: candidate.mediaType, sourceUrl: candidate.href, title: candidate.title, workId: workId(candidate.candidateId) })),
    context: 'local',
    reviewId: snapshot.reviewId,
    revision: snapshot.revision,
    title: snapshot.title,
  };
}

export function createWebBridgeRequestHandler(storage: StoragePort): WebBridgeRequestHandler {
  return async (request: WebRequest): Promise<WebBridgeValue> => {
    if (request.type === 'bootstrap.read') {
      const library = await storage.getLibrary(primaryLibraryId);
      const review = await readReviewQueue(storage);
      const snapshot: WebBootstrapSnapshot = { availability: 'connected', generation: 0, libraryCount: library?.workIds.length ?? 0, pendingReviewCount: review.items.length, protocolVersion: 2 };
      return snapshot;
    }
    if (request.type === 'library.read') {
      const library = await storage.getLibrary(primaryLibraryId);
      const scannedIds = library?.workIds.slice(0, libraryScanLimit) ?? [];
      const works = (await Promise.all(scannedIds.map((id) => storage.getWork(id)))).filter((work): work is Work => work !== undefined);
      const search = normalizeSearch(request.query.search ?? '');
      const filtered = works.filter((work) => (request.query.facet === 'all' || work.mediaKind === request.query.facet)
        && (search.length === 0 || normalizeSearch(work.preferredTitle).includes(search)));
      const start = request.query.cursor === undefined ? 0 : filtered.findIndex((work) => work.id === request.query.cursor) + 1;
      if (request.query.cursor !== undefined && start === 0) throw new Error('invalid-library-cursor');
      const selected = filtered.slice(start, start + request.query.limit);
      const mapped = await Promise.all(selected.map((work) => mapLibraryItem(storage, work)));
      const items = [...mapped];
      let hasMore = start + selected.length < filtered.length;
      let snapshot: WebLibraryPage = { hasMore, items, query: request.query };
      while (!projectionFits(JSON.stringify(snapshot)) && items.length > 0) {
        items.pop();
        hasMore = true;
        snapshot = { hasMore, items, query: request.query };
      }
      const cursor = items.at(-1)?.workId;
      if (hasMore && cursor) snapshot = { ...snapshot, cursor };
      return snapshot;
    }
    if (request.type === 'agenda.read') {
      const from = localMidnight(request.from);
      const to = localMidnight(request.to);
      const period = await readAgendaPeriod(storage, { from, to });
      const entries = period.items.flatMap(({ entry, source, work }) => {
        if (entry.availability === 'unavailable') return [];
        const base = { availability: entry.availability, kind: work.mediaKind, occursAt: entry.occursAt, releaseLabel: entry.releaseLabel, title: work.preferredTitle, workId: work.id };
        return source ? [{ ...base, sourceLabel: source.title, sourceUrl: source.url }] : [base];
      });
      const snapshot: WebAgendaPeriod = { entries: [...entries], from: request.from, to: request.to };
      while (!projectionFits(JSON.stringify(snapshot)) && snapshot.entries.length > 0) snapshot.entries.pop();
      return snapshot;
    }
    if (request.type === 'review.read') {
      const queue = await readReviewQueue(storage);
      if (!queue.items[0]) return { candidates: [], context: 'local' };
      return mapReviewSnapshot(await readLocalReviewCandidateSnapshot(storage, primaryLibraryId, queue.items[0].id));
    }
    if (request.type === 'review.decision.write') {
      await writeLocalReviewDecision(storage, primaryLibraryId, request.command);
      return { candidates: [], context: 'local' };
    }
    return { error: 'unsupported-web-request' };
  };
}
