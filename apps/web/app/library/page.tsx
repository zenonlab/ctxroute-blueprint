'use client';

import { Library } from '@tobirink/ui';
import type { LibraryFiltersValue, LibraryState, LibraryWork } from '@tobirink/ui';
import type { WebLibraryQuery } from '@tobirink/contracts/web-bridge';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { useLibraryRefresh } from './use-library-refresh';
import { BridgeState, WebMemberShell, useWebMemberNavigation } from '../components/SiteShell';
import { WebBridgeProvider, useWebBridge } from '../components/WebBridgeProvider';

const facetNames = ['format', 'genre', 'progress', 'source', 'status', 'type', 'year'] as const;
const emptyFilterOptions = { format: [], genre: [], progress: [], source: [], status: [], type: [], year: [] } as const;

function filtersFrom(searchParams: ReturnType<typeof useSearchParams>): LibraryFiltersValue {
  const selections: Record<(typeof facetNames)[number], Record<string, 'include' | 'exclude'>> = { format: {}, genre: {}, progress: {}, source: {}, status: {}, type: {}, year: {} };
  const sort = searchParams.get('sort');
  const selectedSort = sort === 'PROGRESS_DESC' || sort === 'POPULARITY_DESC' || sort === 'TITLE_ASC' || sort === 'TITLE_DESC' || sort === 'YEAR_DESC' ? sort : 'ADDED_DESC';
  for (const facet of facetNames) for (const encoded of searchParams.getAll(`f.${facet}`).slice(0, 64)) {
    const separator = encoded.indexOf(':');
    const state = encoded.slice(0, separator);
    const option = separator === -1 ? '' : encoded.slice(separator + 1).slice(0, 120);
    if (option && (state === 'include' || state === 'exclude')) selections[facet][option] = state;
  }
  const legacyFacet = searchParams.get('facet');
  if (Object.keys(selections.type).length === 0 && (legacyFacet === 'anime' || legacyFacet === 'manga')) selections.type[legacyFacet.toUpperCase()] = 'include';
  return { ...selections, query: searchParams.get('search')?.slice(0, 120) ?? '', sort: selectedSort };
}

function LibrarySurface() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { readLibrary, status } = useWebBridge();
  const navigation = useWebMemberNavigation();
  const [retryCount, setRetryCount] = useState(0);
  const [filters, setFilters] = useState<LibraryFiltersValue>(() => filtersFrom(searchParams));
  const query = useMemo<WebLibraryQuery>(() => {
    const nextQuery: WebLibraryQuery = { facet: 'all', facets: { format: filters.format, genre: filters.genre, progress: filters.progress, source: filters.source, status: filters.status, type: filters.type, year: filters.year }, limit: 24, sort: filters.sort };
    if (filters.query) nextQuery.search = filters.query;
    return nextQuery;
  }, [filters]);

  const setQuery = (value: LibraryFiltersValue) => {
    const params = new URLSearchParams();
    const nextSearch = value.query.trim();
    if (nextSearch) params.set('search', nextSearch);
    if (value.sort !== 'ADDED_DESC') params.set('sort', value.sort);
    for (const facet of facetNames) for (const [option, selection] of Object.entries(value[facet])) params.append(`f.${facet}`, `${selection}:${option}`);
    setFilters(value);
    History.prototype.replaceState.call(window.history, null, '', params.size > 0 ? `/library?${params.toString()}` : '/library');
  };

  const { page, loading, failed, loadMore } = useLibraryRefresh(readLibrary, status === 'connected', query, retryCount);
  const nextCursor = page?.cursor;
  const items: readonly LibraryWork[] = page?.items.map((item) => ({
    coverAlt: item.coverAttribution ? `Couverture de ${item.title} — ${item.coverAttribution}` : undefined,
    coverSrc: item.coverUrl,
    coverFallbackSrc: item.coverFallbackUrl,
    detail: [item.resolutionState === 'preparation' ? 'Préparation' : item.resolutionState === 'retryable' ? 'Reprise automatique' : item.resolutionState === 'review' ? 'À vérifier' : undefined, item.format, item.startYear, item.provider].filter(Boolean).join(' · ') || undefined,
    href: item.sourceUrl ?? item.canonicalUrl ?? `/library/_?work=${encodeURIComponent(item.workId)}`,
    id: item.workId,
    mediaType: item.mediaKind === 'anime' ? 'Anime' : item.mediaKind === 'manga' ? 'Manga' : 'Type à déterminer',
    progress: item.progressLabel,
    source: (item.sourceUrl ? new URL(item.sourceUrl).hostname : undefined) ?? item.provider ?? 'Fiche locale',
    title: item.title,
  })) ?? [];

  if (status === 'loading' || status === 'reconnecting') return <WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>;
  if (status === 'extension-missing') return <Library extensionRequired filterOptions={emptyFilterOptions} filters={filters} items={[]} navigation={navigation} onChangeFilters={setQuery} onDownloadExtension={() => router.push('/download')} onLoadMore={() => undefined} onOpenRecovery={() => setRetryCount((count) => count + 1)} onRetry={() => setRetryCount((count) => count + 1)} state="empty" />;
  if (status === 'incompatible' || status === 'error') return <WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>;
  const filtered = filters.query.length > 0 || facetNames.some((facet) => Object.keys(filters[facet]).length > 0);
  const state: LibraryState = failed ? 'error' : loading && !page ? 'loading' : page && items.length === 0 && !filtered ? 'empty' : 'ready';

  return <Library
    filterOptions={page?.facets ?? emptyFilterOptions}
    filters={filters}
    hasMore={Boolean(page?.hasMore && nextCursor)}
    items={items}
    navigation={navigation}
    onChangeFilters={setQuery}
    onDownloadExtension={() => router.push('/download')}
    onLoadMore={() => { void loadMore(); }}
    onOpenRecovery={() => setRetryCount((count) => count + 1)}
    onRetry={() => setRetryCount((count) => count + 1)}
    state={state}
    statistics={page?.statistics}
  />;
}

export default function LibraryPage() {
  return <WebBridgeProvider><Suspense fallback={<WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>}><LibrarySurface /></Suspense></WebBridgeProvider>;
}
