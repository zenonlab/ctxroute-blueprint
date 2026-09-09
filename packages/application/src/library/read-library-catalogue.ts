import type { Progress, ProviderCandidate, Work } from '@tobirink/domain';
import type { StoragePort, StorageReadPort } from '../ports/storage-port';
import { libraryCataloguePageLimit, libraryCatalogueScanLimit, libraryFacetLimit } from './library-catalogue-contract';
import type { LibraryCatalogueItem, LibraryCatalogueQuery, LibraryCatalogueSnapshot, LibraryFacetName, LibraryFacetOption, LibraryFacetState, LibrarySort } from './library-catalogue-contract';

function key(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('fr');
}

function detailedType(work: Work): string {
  return work.hydration?.candidate.mediaKind ?? work.mediaKind.toUpperCase();
}

function progressState(progress: Progress | undefined): string {
  if (progress === undefined || progress.value === 0) return 'NOT_STARTED';
  return progress.maximum !== undefined && progress.value >= progress.maximum ? 'COMPLETED' : 'IN_PROGRESS';
}

function values(item: LibraryCatalogueItem, facet: LibraryFacetName): readonly string[] {
  const candidate = item.work.hydration?.candidate;
  if (facet === 'genre') return candidate?.genres?.map(key) ?? [];
  if (facet === 'format') return candidate?.format ? [key(candidate.format)] : [];
  if (facet === 'status') return candidate?.editorialStatus ? [candidate.editorialStatus] : [];
  if (facet === 'type') return [detailedType(item.work)];
  if (facet === 'year') return candidate?.startYear ? [String(candidate.startYear)] : [];
  if (facet === 'source') return [candidate?.provider ?? item.work.externalReferences[0]?.provider ?? 'local'];
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
  const titles = left.work.preferredTitle.localeCompare(right.work.preferredTitle, 'fr', { sensitivity: 'base' });
  let result = 0;
  if (sort === 'TITLE_ASC') result = titles;
  else if (sort === 'TITLE_DESC') result = -titles;
  else if (sort === 'ADDED_DESC') result = right.addedOrder - left.addedOrder;
  else if (sort === 'YEAR_DESC') result = compareOptional(left.work.hydration?.candidate.startYear, right.work.hydration?.candidate.startYear, 'desc');
  else if (sort === 'PROGRESS_DESC') result = compareOptional(progressValue(left.progress), progressValue(right.progress), 'desc');
  else {
    result = compareOptional(popularity(left.work.hydration?.candidate, popularityCohort), popularity(right.work.hydration?.candidate, popularityCohort), 'desc');
  }
  return result || titles || left.work.id.localeCompare(right.work.id);
}

function selectPopularityCohort(items: readonly LibraryCatalogueItem[]): string | undefined {
  const counts = new Map<string, number>();
  for (const item of items) {
    const candidate = item.work.hydration?.candidate;
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
  const candidate = item.work.hydration?.candidate;
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

async function readCatalogueSnapshot(storage: StorageReadPort, input: LibraryCatalogueQuery): Promise<LibraryCatalogueSnapshot> {
  const library = await storage.getLibrary(input.libraryId);
  if (library === undefined) return { facets: buildFacets([]), items: [], statistics: { completed: 0, inProgress: 0, knownMetadata: 0, notStarted: 0, total: 0 }, total: 0, truncated: false };
  const limit = input.limit ?? libraryCataloguePageLimit;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > libraryCataloguePageLimit || !Number.isInteger(offset) || offset < 0) throw new RangeError('Library catalogue pagination is invalid.');
  const selectedIds = library.workIds.slice(0, libraryCatalogueScanLimit);
  const records = await Promise.all(selectedIds.map(async (id, addedOrder) => {
    const work = await storage.getWork(id);
    if (work === undefined) return undefined;
    const progress = await storage.findProgressByWorkId(id);
    return progress === undefined ? { addedOrder, work } : { addedOrder, progress, work };
  }));
  const corpus = records.filter((item): item is LibraryCatalogueItem => item !== undefined);
  const normalizedQuery = key(input.query ?? '');
  const filtered = corpus.filter((item) => (normalizedQuery.length === 0 || key(item.work.preferredTitle).includes(normalizedQuery))
    && facetNames.every((facet) => matchesFacet(item, facet, input.facets?.[facet])));
  const sort = input.sort ?? 'ADDED_DESC';
  const popularityCohort = sort === 'POPULARITY_DESC' ? selectPopularityCohort(filtered) : undefined;
  const ordered = [...filtered].sort((left, right) => compare(left, right, sort, popularityCohort));
  const end = offset + limit;
  const snapshot: LibraryCatalogueSnapshot = {
    facets: buildFacets(corpus),
    items: Object.freeze(ordered.slice(offset, end)),
    statistics: Object.freeze({
      completed: corpus.filter((item) => progressState(item.progress) === 'COMPLETED').length,
      inProgress: corpus.filter((item) => progressState(item.progress) === 'IN_PROGRESS').length,
      knownMetadata: corpus.filter((item) => item.work.hydration?.candidate.metadataVersion === 1).length,
      notStarted: corpus.filter((item) => progressState(item.progress) === 'NOT_STARTED').length,
      total: corpus.length,
    }),
    total: ordered.length,
    truncated: library.workIds.length > libraryCatalogueScanLimit,
  };
  return Object.freeze(end < ordered.length ? { ...snapshot, nextOffset: end } : snapshot);
}

export function readLibraryCatalogue(storage: StoragePort, input: LibraryCatalogueQuery): Promise<LibraryCatalogueSnapshot> {
  return storage.transaction(['libraries', 'progress', 'works'], async (session) => readCatalogueSnapshot(session, input));
}
