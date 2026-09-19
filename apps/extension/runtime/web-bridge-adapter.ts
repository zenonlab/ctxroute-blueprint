import { providerCoverFallbackPath, readAgendaPeriod, readLibraryBootstrapSummary, readLibraryCatalogue, readLocalReleaseAgenda, readReviewQueue } from '@tobirink/application';
import type { LocalReleaseAgendaPort, PublicDiscoveryRequestClientPort, StoragePort } from '@tobirink/application';
import { isContentVisible, libraryId, workId } from '@tobirink/domain';
import type { FavoriteSource, WorkId } from '@tobirink/domain';
import type { LibraryCatalogueItem } from '@tobirink/application';
import type { WebAgendaPeriod, WebBootstrapSnapshot, WebLibraryItem, WebLibraryPage, WebRequest, WebReviewSnapshot } from '@tobirink/contracts/web-bridge';
import { readLocalReviewCandidateSnapshot, writeLocalReviewDecision } from './local-review-runtime';
import type { WebBridgeRequestHandler, WebBridgeValue } from './web-bridge-runtime';

const primaryLibraryId = libraryId('library_primary');
const projectionByteLimit = 60 * 1024;

function localMidnight(dateOnly: string): string {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toISOString();
}

function projectionFits(serialized: string): boolean {
  return new TextEncoder().encode(serialized).byteLength <= projectionByteLimit;
}

async function preferredSource(storage: StoragePort, id: WorkId): Promise<FavoriteSource | undefined> {
  const sources = await storage.listFavoriteSourcesByWorkId({ limit: 100, workId: id });
  return sources.filter((source) => source.presence === 'observed')
    .sort((left, right) => left.folderPath.join('\u0000').localeCompare(right.folderPath.join('\u0000')) || left.order - right.order || left.id.localeCompare(right.id))[0];
}

function progressLabel(progress: Awaited<ReturnType<StoragePort['findProgressByWorkId']>>): string | undefined {
  if (progress === undefined) return undefined;
  const label = progress.kind === 'episode' ? 'Épisode' : progress.kind === 'volume' ? 'Volume' : 'Chapitre';
  return `${label} ${progress.value}${progress.maximum === undefined ? '' : `/${progress.maximum}`}`;
}

function projectedUrl(value: string | undefined, limit: number): string | undefined {
  return value !== undefined && value.length <= limit ? value : undefined;
}

function projectedText(value: string, limit: number): string {
  return value.slice(0, limit);
}

async function mapLibraryItem(storage: StoragePort, item: LibraryCatalogueItem): Promise<WebLibraryItem> {
  const { candidate, progress } = item;
  const source = item.source ?? (item.work === undefined ? undefined : await preferredSource(storage, item.work.id));
  const base: WebLibraryItem = { mediaKind: item.mediaKind, resolutionState: item.state, title: projectedText(item.title, 240), workId: workId(item.id) };
  const label = progressLabel(progress);
  if (label !== undefined) base.progressLabel = label;
  if (progress !== undefined) base.progress = progress.maximum === undefined
    ? { kind: progress.kind, value: progress.value }
    : { kind: progress.kind, maximum: progress.maximum, value: progress.value };
  if (source !== undefined) {
    const sourceUrl = projectedUrl(source.url, 2048);
    if (sourceUrl !== undefined) base.sourceUrl = sourceUrl;
  }
  if (candidate === undefined) return base;
  const fallback = providerCoverFallbackPath(candidate);
  if (fallback !== undefined) base.coverFallbackUrl = new URL(fallback, 'https://tobirink.com').href;
  const canonicalUrl = projectedUrl(candidate.canonicalUrl, 2048);
  const coverUrl = projectedUrl(candidate.cover?.url, 4096);
  if (canonicalUrl !== undefined) base.canonicalUrl = canonicalUrl;
  if (coverUrl !== undefined) base.coverUrl = coverUrl;
  if (candidate.cover !== undefined) base.coverAttribution = projectedText(candidate.cover.attribution, 120);
  if (candidate.format !== undefined) base.format = projectedText(candidate.format, 120);
  if (candidate.genres !== undefined) base.genres = candidate.genres.map((genre) => projectedText(genre, 120));
  if (candidate.editorialStatus !== undefined) base.editorialStatus = candidate.editorialStatus;
  if (candidate.startYear !== undefined) base.startYear = candidate.startYear;
  if (candidate.endYear !== undefined) base.endYear = candidate.endYear;
  if (candidate.episodeCount !== undefined) base.episodeCount = candidate.episodeCount;
  if (candidate.chapterCount !== undefined) base.chapterCount = candidate.chapterCount;
  if (candidate.volumeCount !== undefined) base.volumeCount = candidate.volumeCount;
  if (candidate.popularity !== undefined) base.popularity = candidate.popularity;
  base.provider = projectedText(candidate.provider, 120);
  if (candidate.titleVariants !== undefined) base.titleVariants = candidate.titleVariants.map((variant) => variant.language === undefined
    ? { title: projectedText(variant.title, 240) }
    : { language: projectedText(variant.language, 120), title: projectedText(variant.title, 240) });
  return base;
}

function libraryOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const match = /^offset:(\d{1,6})$/u.exec(cursor);
  const offset = Number(match?.[1]);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid-library-cursor');
  return offset;
}

function mapReviewSnapshot(snapshot: Awaited<ReturnType<typeof readLocalReviewCandidateSnapshot>>): WebReviewSnapshot {
  return {
    reason: snapshot.reason,
    matchLevel: snapshot.matchLevel,
    provenance: snapshot.provenance,
    totalCandidates: snapshot.totalCandidates,
    candidates: snapshot.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      coverAlt: candidate.coverAlt,
      coverFallbackSrc: candidate.coverFallbackSrc,
      coverSrc: candidate.coverSrc,
      mediaKind: candidate.mediaType, sourceUrl: candidate.href, title: candidate.title, workId: workId(candidate.candidateId),
    })),
    context: 'local',
    reviewId: snapshot.reviewId,
    revision: snapshot.revision,
    title: snapshot.title,
  };
}

export function createWebBridgeRequestHandler(storage: StoragePort, publicDiscovery?: PublicDiscoveryRequestClientPort, localAgenda?: LocalReleaseAgendaPort, readShowAdultContent: () => Promise<boolean> = async () => true): WebBridgeRequestHandler {
  return async (request: WebRequest): Promise<WebBridgeValue> => {
    if (request.type === 'bootstrap.read') {
      const [library, review] = await Promise.all([
        readLibraryBootstrapSummary(storage, primaryLibraryId),
        readReviewQueue(storage, await readShowAdultContent()),
      ]);
      const snapshot: WebBootstrapSnapshot = { availability: 'connected', generation: 0, libraryCount: library.libraryCount, pendingReviewCount: review.items.length, protocolVersion: 4 };
      return snapshot;
    }
    if (request.type === 'library.read') {
      const start = libraryOffset(request.query.cursor);
      const legacyType = request.query.facet === 'all' ? undefined : { [request.query.facet.toUpperCase()]: 'include' as const };
      const facets = legacyType === undefined ? request.query.facets : { ...request.query.facets, type: request.query.facets?.type ?? legacyType };
      const catalogue = await readLibraryCatalogue(storage, {
        facets, libraryId: primaryLibraryId, limit: request.query.limit, offset: start, showAdultContent: await readShowAdultContent(),
        query: request.query.search, sort: request.query.sort,
      });
      let selected = catalogue.items;
      if (request.query.workId !== undefined) {
        const requestedWork = await storage.getWork(workId(request.query.workId));
        if (requestedWork === undefined) selected = [];
        else if (!isContentVisible(requestedWork.hydration?.candidate, await readShowAdultContent())) selected = [];
        else {
          const progress = await storage.findProgressByWorkId(requestedWork.id);
          const base: LibraryCatalogueItem = requestedWork.hydration === undefined
            ? { addedOrder: 0, id: requestedWork.id, mediaKind: requestedWork.mediaKind, state: 'ready', title: requestedWork.preferredTitle, work: requestedWork }
            : { addedOrder: 0, candidate: requestedWork.hydration.candidate, id: requestedWork.id, mediaKind: requestedWork.mediaKind, state: 'ready', title: requestedWork.preferredTitle, work: requestedWork };
          selected = progress === undefined ? [base] : [{ ...base, progress }];
        }
      }
      const mapped = await Promise.all(selected.map((item) => mapLibraryItem(storage, item)));
      const items = [...mapped];
      let hasMore = catalogue.nextOffset !== undefined;
      const projectedFacets = {
        format: [...catalogue.facets.format], genre: [...catalogue.facets.genre], progress: [...catalogue.facets.progress],
        source: [...catalogue.facets.source], status: [...catalogue.facets.status], type: [...catalogue.facets.type], year: [...catalogue.facets.year],
      };
      let snapshot: WebLibraryPage = { facets: projectedFacets, hasMore, items, query: request.query, statistics: catalogue.statistics, total: request.query.workId === undefined ? catalogue.total : items.length, truncated: catalogue.truncated };
      while (!projectionFits(JSON.stringify(snapshot)) && items.length > 0) {
        items.pop();
        hasMore = true;
        snapshot = { ...snapshot, hasMore, items };
      }
      if (hasMore && items.length > 0) snapshot = { ...snapshot, cursor: `offset:${start + items.length}` };
      return snapshot;
    }
    if (request.type === 'agenda.read') {
      const from = localMidnight(request.from);
      const to = localMidnight(request.to);
      const legacy = localAgenda === undefined ? await readAgendaPeriod(storage, { from, to }) : undefined;
      if (legacy !== undefined && legacy.items.length >= 100) return { error: 'agenda-period-too-large' };
      const projected = localAgenda === undefined ? undefined : await readLocalReleaseAgenda(storage, localAgenda, { from, to, civilFrom: request.from, civilTo: request.to });
      const showAdultContent = await readShowAdultContent();
      const periodItems = projected?.items.filter(({ work }) => isContentVisible(work.hydration?.candidate, showAdultContent)).map(({ event, source, work }) => ({ occurrence: event.occurrence, availability: event.availability, releaseLabel: event.releaseLabel, source, work })) ?? legacy?.items.filter(({ work }) => isContentVisible(work.hydration?.candidate, showAdultContent)).map(({ entry, source, work }) => ({ occurrence: { kind: 'INSTANT' as const, value: entry.occursAt }, availability: entry.availability, releaseLabel: entry.releaseLabel, source, work })) ?? [];
      const entries = periodItems.flatMap(({ availability, occurrence, releaseLabel, source, work }) => {
        if (availability === 'unavailable') return [];
        const base = { availability, kind: work.mediaKind, releaseLabel, title: work.preferredTitle, workId: work.id };
        const dated = occurrence.kind === 'DATE' ? { ...base, occursOn: occurrence.value } : { ...base, occursAt: occurrence.value };
        return source ? [{ ...dated, sourceLabel: source.title, sourceUrl: source.url }] : [dated];
      });
      const snapshot: WebAgendaPeriod = { entries: [...entries], from: request.from, to: request.to };
      if (snapshot.entries.length > 100 || !projectionFits(JSON.stringify(snapshot))) return { error: 'agenda-period-too-large' };
      return snapshot;
    }
    if (request.type === 'review.read') {
      const queue = await readReviewQueue(storage, await readShowAdultContent());
      if (!queue.items[0]) return { candidates: [], context: 'local' };
      return mapReviewSnapshot(await readLocalReviewCandidateSnapshot(storage, primaryLibraryId, queue.items[0].id, await readShowAdultContent()));
    }
    if (request.type === 'review.decision.write') {
      await writeLocalReviewDecision(storage, primaryLibraryId, request.command, publicDiscovery, await readShowAdultContent());
      return { candidates: [], context: 'local' };
    }
    return { error: 'unsupported-web-request' };
  };
}
