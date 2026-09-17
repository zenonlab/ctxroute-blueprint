import { providerCoverFallbackPath, readLibraryCatalogue } from '@tobirink/application';
import type { LibraryCatalogueQuery, StoragePort } from '@tobirink/application';
import type { LibraryId, ProviderCandidate, ProviderEditorialStatus } from '@tobirink/domain';
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
  mediaType: 'anime' | 'manga' | 'unknown';
  progress?: string;
  source: string;
  state: 'preparation' | 'ready' | 'retryable' | 'review';
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

function itemDetail(candidate: ProviderCandidate | undefined, state: ProjectedLibraryItem['state']): string | undefined {
  const facts = [candidate?.format, candidate?.startYear?.toString(), candidate?.editorialStatus ? statusLabels[candidate.editorialStatus] : undefined].filter((value): value is string => value !== undefined);
  if (facts.length > 0) return displayText(facts.join(' · '), 300);
  return state === 'ready' ? undefined : state === 'review' ? 'À vérifier' : state === 'retryable' ? 'Reprise automatique' : 'Préparation';
}

export async function readLocalLibraryCatalogueSnapshot(
  storage: StoragePort,
  libraryId: LibraryId,
  input: Omit<LibraryCatalogueRequest, 'type' | 'version'>,
  showAdultContent = true,
) {
  const query: LibraryCatalogueQuery = { libraryId, showAdultContent, sort: input.sort };
  if (input.facets !== undefined) Object.assign(query, { facets: input.facets });
  if (input.offset !== undefined) Object.assign(query, { offset: input.offset });
  if (input.query !== undefined) Object.assign(query, { query: input.query });
  const snapshot = await readLibraryCatalogue(storage, query);
  const items = snapshot.items.map(({ candidate, id, mediaKind, progress, source, state, title }) => {
    const base = {
      id,
      mediaType: mediaKind,
      source: displayText(candidate?.provider ?? 'local', 64),
      state,
      title: displayText(title, 300),
    };
    const detail = itemDetail(candidate, state);
    const progressLabel = progress === undefined ? undefined : `${progress.value} / ${progress.maximum ?? '?'}`;
    const coverSrc = displayUrl(candidate?.cover?.url, 4096);
    const href = displayUrl(source?.url ?? candidate?.canonicalUrl, 8192);
    const item: ProjectedLibraryItem = base;
    const fallback = candidate === undefined ? undefined : providerCoverFallbackPath(candidate);
    if (fallback !== undefined) item.coverFallbackSrc = new URL(fallback, 'https://tobirink.com').href;
    if (coverSrc !== undefined) {
      item.coverAlt = displayText(`Couverture de ${title} — ${candidate?.cover?.attribution ?? candidate?.provider ?? 'source'}`, 500);
      item.coverSrc = coverSrc;
    }
    if (href !== undefined) item.href = href;
    if (detail !== undefined) item.detail = detail;
    if (progressLabel !== undefined) item.progress = progressLabel;
    return item;
  });
  return Object.freeze({ ...snapshot, items: Object.freeze(items) });
}
