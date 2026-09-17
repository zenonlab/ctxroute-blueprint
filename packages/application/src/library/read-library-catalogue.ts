import { isContentVisible } from '@tobirink/domain';
import type { LibraryId, Progress, ProviderCandidate } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { libraryCataloguePageLimit, libraryCatalogueReadBatchSize, libraryFacetLimit } from './library-catalogue-contract';
import type { LibraryCatalogueItem, LibraryCatalogueQuery, LibraryCatalogueSnapshot, LibraryFacetName, LibraryFacetOption, LibraryFacetState, LibrarySort } from './library-catalogue-contract';
import { projectFavoriteSources } from './project-pending-favorites';

function key(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('fr');
}

function detailedType(item: LibraryCatalogueItem): string {
  return item.candidate?.mediaKind ?? item.mediaKind.toUpperCase();
}

function progressState(progress: Progress | undefined): string {
  if (progress === undefined || progress.value === 0) return 'NOT_STARTED';
  return progress.maximum !== undefined && progress.value >= progress.maximum ? 'COMPLETED' : 'IN_PROGRESS';
}

function values(item: LibraryCatalogueItem, facet: LibraryFacetName): readonly string[] {
  const candidate = item.candidate;
  if (facet === 'genre') return candidate?.genres?.map(key) ?? [];
  if (facet === 'format') return candidate?.format ? [key(candidate.format)] : [];
  if (facet === 'status') return candidate?.editorialStatus ? [candidate.editorialStatus] : [];
  if (facet === 'type') return [detailedType(item)];
  if (facet === 'year') return candidate?.startYear ? [String(candidate.startYear)] : [];
  if (facet === 'source') return [candidate?.provider ?? item.work?.externalReferences[0]?.provider ?? 'local'];
  return [progressState(item.progress)];
}

function matchesFacet(item: LibraryCatalogueItem, facet: LibraryFacetName, selection: Readonly<Record<string, LibraryFacetState>> | undefined): boolean {
  if (selection === undefined) return true;
  const itemValues = new Set(values(item, facet));
  const entries = Object.entries(selection);
  const included = entries.filter(([, state]) => state === 'include').map(([value]) => value);
  const excluded = entries.filter(([, state]) => state === 'exclude').map(([value]) => value);
  return excluded.every((value) => !itemValues.has(value)) && (included.length === 0 || included.some((value) => itemValues.has(value)));
}

function compareOptional(left: number | undefined, right: number | undefined, direction: 'asc' | 'desc'): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return direction === 'asc' ? left - right : right - left;
}

function popularity(candidate: ProviderCandidate | undefined, cohort: string | undefined): number | undefined {
  if (candidate?.popularity === undefined) return undefined;
  if ([candidate.provider, candidate.popularity.kind].join(':') !== cohort) return undefined;
  return candidate.popularity.kind === 'RANK' ? -candidate.popularity.value : candidate.popularity.value;
}

function progressValue(progress: Progress | undefined): number | undefined {
  if (progress === undefined) return undefined;
  return progress.maximum === undefined || progress.maximum === 0 ? progress.value : progress.value / progress.maximum;
}

function compare(left: LibraryCatalogueItem, right: LibraryCatalogueItem, sort: LibrarySort, popularityCohort?: string): number {
  const titles = left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' });
  let result = 0;
  if (sort === 'TITLE_ASC') result = titles;
  else if (sort === 'TITLE_DESC') result = -titles;
  else if (sort === 'ADDED_DESC') result = right.addedOrder - left.addedOrder;
  else if (sort === 'YEAR_DESC') result = compareOptional(left.candidate?.startYear, right.candidate?.startYear, 'desc');
  else if (sort === 'PROGRESS_DESC') result = compareOptional(progressValue(left.progress), progressValue(right.progress), 'desc');
  else {
    result = compareOptional(popularity(left.candidate, popularityCohort), popularity(right.candidate, popularityCohort), 'desc');
  }
  return result || titles || left.id.localeCompare(right.id);
}

function selectPopularityCohort(items: readonly LibraryCatalogueItem[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    const candidate = item.candidate;
    if (candidate?.popularity === undefined) continue;
    const cohort = [candidate.provider, candidate.popularity.kind].join(':');
    counts.set(cohort, (counts.get(cohort) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
}

const facetNames: readonly LibraryFacetName[] = ['genre', 'status', 'type', 'format', 'year', 'progress', 'source'];
const labels: Readonly<Record<string, string>> = Object.freeze({
  ANIME: 'Anime', MANGA: 'Manga', MANHWA: 'Manhwa', MANHUA: 'Manhua', UPCOMING: 'À venir', ONGOING: 'En cours', HIATUS: 'En pause', COMPLETED: 'Terminé', CANCELLED: 'Annulé', UNKNOWN: 'Inconnu', NOT_STARTED: 'Non commencé', IN_PROGRESS: 'En cours', anilist: 'AniList', mangaupdates: 'MangaUpdates', mangadex: 'MangaDex', 'kitsu-anime': 'Kitsu Anime', 'kitsu-manga': 'Kitsu Manga', local: 'Locale',
});

function facetLabel(item: LibraryCatalogueItem, facet: LibraryFacetName, value: string): string {
  const candidate = item.candidate;
  if (facet === 'genre') return candidate?.genres?.find((genre) => key(genre) === value) ?? value;
  if (facet === 'format') return candidate?.format ?? value;
  return labels[value] ?? value;
}

function buildFacets(items: readonly LibraryCatalogueItem[]): LibraryCatalogueSnapshot['facets'] {
  const result: Record<LibraryFacetName, LibraryFacetOption[]> = { format: [], genre: [], progress: [], source: [], status: [], type: [], year: [] };
  for (const facet of facetNames) {
    const counts = new Map<string, { count: number; label: string }>();
    for (const item of items) for (const value of values(item, facet)) {
      const current = counts.get(value);
      counts.set(value, { count: (current?.count ?? 0) + 1, label: facetLabel(item, facet, value) });
    }
    result[facet] = [...counts.entries()].map(([value, entry]) => ({ ...entry, value })).sort((left, right) => left.label.localeCompare(right.label, 'fr')).slice(0, libraryFacetLimit);
  }
  return Object.freeze(result);
}

async function readCatalogueSnapshot(storage: StoragePort, input: LibraryCatalogueQuery): Promise<LibraryCatalogueSnapshot> {
  const library = await storage.getLibrary(input.libraryId);
  const limit = input.limit ?? libraryCataloguePageLimit;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > libraryCataloguePageLimit || !Number.isInteger(offset) || offset < 0) throw new RangeError('Library catalogue pagination is invalid.');
  const corpus: LibraryCatalogueItem[] = [];
  const resolvedWorkIds = new Set<string>();
  const workIds = library?.workIds ?? [];
  for (let start = 0; start < workIds.length; start += libraryCatalogueReadBatchSize) {
    const batch = workIds.slice(start, start + libraryCatalogueReadBatchSize);
    const records = await storage.transaction(['progress', 'works'], async (session) => {
      const works = await session.getWorks(batch);
      const progressByWorkId = new Map((await session.findProgressByWorkIds(batch)).map((progress) => [progress.workId, progress]));
      return batch.map((id, index): LibraryCatalogueItem | undefined => {
        const work = works[index];
        if (work === undefined) return undefined;
        const progress = progressByWorkId.get(id);
        const addedOrder = start + index;
        resolvedWorkIds.add(work.id);
        const item: LibraryCatalogueItem = work.hydration === undefined
          ? { addedOrder, id: work.id, mediaKind: work.mediaKind, state: 'ready', title: work.preferredTitle, work }
          : { addedOrder, candidate: work.hydration.candidate, id: work.id, mediaKind: work.mediaKind, state: 'ready', title: work.preferredTitle, work };
        return progress === undefined ? item : { ...item, progress };
      });
    });
    corpus.push(...records.filter((item): item is LibraryCatalogueItem => item !== undefined));
  }
  const sourceProjection = await projectFavoriteSources(storage, resolvedWorkIds);
  for (const [index, item] of corpus.entries()) {
    const source = sourceProjection.sourceByWorkId.get(item.id);
    if (source !== undefined) corpus[index] = { ...item, addedOrder: source.order, source };
  }
  corpus.push(...sourceProjection.pending);
  const normalizedQuery = key(input.query ?? '');
  const showAdultContent = input.showAdultContent;
  const visible = showAdultContent === undefined ? corpus : corpus.filter((item) => isContentVisible(item.candidate, showAdultContent));
  const filtered = visible.filter((item) => (normalizedQuery.length === 0 || key(item.title).includes(normalizedQuery))
    && facetNames.every((facet) => matchesFacet(item, facet, input.facets?.[facet])));
  const sort = input.sort ?? 'ADDED_DESC';
  const popularityCohort = sort === 'POPULARITY_DESC' ? selectPopularityCohort(filtered) : undefined;
  const ordered = [...filtered].sort((left, right) => compare(left, right, sort, popularityCohort));
  const end = offset + limit;
  const snapshot: LibraryCatalogueSnapshot = {
    facets: buildFacets(visible),
    items: Object.freeze(ordered.slice(offset, end)),
    statistics: Object.freeze({
      completed: visible.filter((item) => progressState(item.progress) === 'COMPLETED').length,
      inProgress: visible.filter((item) => progressState(item.progress) === 'IN_PROGRESS').length,
      knownMetadata: visible.filter((item) => item.candidate?.metadataVersion !== undefined).length,
      notStarted: visible.filter((item) => progressState(item.progress) === 'NOT_STARTED').length,
      total: visible.length,
    }),
    total: ordered.length,
    truncated: false,
  };
  return Object.freeze(end < ordered.length ? { ...snapshot, nextOffset: end } : snapshot);
}

export async function readLibraryBootstrapSummary(storage: StoragePort, libraryId: LibraryId): Promise<{ libraryCount: number }> {
  const [library, pending] = await Promise.all([
    storage.getLibrary(libraryId),
    storage.readPendingFavoriteProjectionCount(),
  ]);
  return Object.freeze({ libraryCount: (library?.workIds.length ?? 0) + pending });
}

export function readLibraryCatalogue(storage: StoragePort, input: LibraryCatalogueQuery): Promise<LibraryCatalogueSnapshot> {
  return readCatalogueSnapshot(storage, input);
}
