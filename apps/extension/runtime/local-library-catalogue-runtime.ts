import { providerCoverFallbackPath, readLibraryCatalogue } from '@tobirink/application';
import type { LibraryCatalogueQuery, StoragePort } from '@tobirink/application';
import type { LibraryId, ProviderEditorialStatus } from '@tobirink/domain';
import type { LibraryCatalogueRequest } from './library-catalogue-messages';

const statusLabels: Readonly<Record<ProviderEditorialStatus, string>> = Object.freeze({
  CANCELLED: 'Annulé',
  COMPLETED: 'Terminé',
  HIATUS: 'En pause',
  ONGOING: 'En cours',
  UNKNOWN: 'Statut inconnu',
  UPCOMING: 'À venir',
});

interface ProjectedLibraryItem {
  coverFallbackSrc?: string;
  coverAlt?: string;
  coverSrc?: string;
  detail?: string;
  href?: string;
  id: string;
  mediaType: 'anime' | 'manga';
  progress?: string;
  source: string;
  title: string;
}

function displayText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const truncated = value.slice(0, limit);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  return finalCodeUnit >= 0xD800 && finalCodeUnit <= 0xDBFF ? truncated.slice(0, -1) : truncated;
}

function displayUrl(value: string | undefined, limit: number): string | undefined {
  if (value === undefined || value.length > limit) return undefined;
  const url = new URL(value);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
}

function itemDetail(work: Awaited<ReturnType<StoragePort['getWork']>>): string | undefined {
  const candidate = work?.hydration?.candidate;
  if (candidate === undefined) return undefined;
  const facts = [candidate.format, candidate.startYear?.toString(), candidate.editorialStatus ? statusLabels[candidate.editorialStatus] : undefined].filter((value): value is string => value !== undefined);
  return facts.length > 0 ? displayText(facts.join(' · '), 300) : undefined;
}

export async function readLocalLibraryCatalogueSnapshot(
  storage: StoragePort,
  libraryId: LibraryId,
  input: Omit<LibraryCatalogueRequest, 'type' | 'version'>,
) {
  const query: LibraryCatalogueQuery = { libraryId, sort: input.sort };
  if (input.facets !== undefined) Object.assign(query, { facets: input.facets });
  if (input.offset !== undefined) Object.assign(query, { offset: input.offset });
  if (input.query !== undefined) Object.assign(query, { query: input.query });
  const snapshot = await readLibraryCatalogue(storage, query);
  const items = snapshot.items.map(({ progress, work }) => {
    const candidate = work.hydration?.candidate;
    const base = {
      id: work.id,
      mediaType: work.mediaKind,
      source: displayText(candidate?.provider ?? work.externalReferences[0]?.provider ?? work.mediaKind, 64),
      title: displayText(work.preferredTitle, 300),
    };
    const detail = itemDetail(work);
    const progressLabel = progress === undefined ? undefined : `${progress.value} / ${progress.maximum ?? '?'}`;
    const coverSrc = displayUrl(candidate?.cover?.url, 4096);
    const href = displayUrl(candidate?.canonicalUrl, 8192);
    const item: ProjectedLibraryItem = base;
    const fallback = candidate === undefined ? undefined : providerCoverFallbackPath(candidate);
    if (fallback !== undefined) item.coverFallbackSrc = new URL(fallback, 'https://tobirink.com').href;
    if (coverSrc !== undefined) {
      item.coverAlt = displayText(`Couverture de ${work.preferredTitle} — ${candidate?.cover?.attribution ?? candidate?.provider ?? 'source'}`, 500);
      item.coverSrc = coverSrc;
    }
    if (href !== undefined) item.href = href;
    if (detail !== undefined) item.detail = detail;
    if (progressLabel !== undefined) item.progress = progressLabel;
    return item;
  });
  return Object.freeze({ ...snapshot, items: Object.freeze(items) });
}
