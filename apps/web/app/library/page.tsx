'use client';

import { Library } from '@tobirink/ui';
import type { LibraryFiltersValue, LibraryState, LibraryWork } from '@tobirink/ui';
import type { WebLibraryPage, WebLibraryQuery } from '@tobirink/contracts/web-bridge';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { BridgeState, WebMemberShell, useWebMemberNavigation } from '../components/SiteShell';
import { WebBridgeProvider, useWebBridge } from '../components/WebBridgeProvider';

const typeOptions = [{ label: 'Anime', value: 'anime' }, { label: 'Manga', value: 'manga' }] as const;
const filterOptions = { progress: [], status: [], type: typeOptions } as const;

function LibrarySurface() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { readLibrary, status } = useWebBridge();
  const navigation = useWebMemberNavigation();
  const [page, setPage] = useState<WebLibraryPage>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const search = searchParams.get('search')?.slice(0, 120) ?? '';
  const facetValue = searchParams.get('facet');
  const facet: WebLibraryQuery['facet'] = facetValue === 'anime' || facetValue === 'manga' ? facetValue : 'all';
  const cursor = searchParams.get('cursor')?.slice(0, 128) || undefined;
  const query = useMemo<WebLibraryQuery>(() => {
    const nextQuery: WebLibraryQuery = { facet, limit: 24 };
    if (cursor) nextQuery.cursor = cursor;
    if (search) nextQuery.search = search;
    return nextQuery;
  }, [cursor, facet, search]);
  const filters: LibraryFiltersValue = { progress: {}, query: search, status: {}, type: facet === 'all' ? {} : { [facet]: 'include' } };

  const setQuery = (value: LibraryFiltersValue) => {
    const params = new URLSearchParams();
    const nextSearch = value.query.trim();
    const nextFacet = Object.entries(value.type).find(([, selection]) => selection === 'include')?.[0];
    if (nextSearch) params.set('search', nextSearch);
    if (nextFacet === 'anime' || nextFacet === 'manga') params.set('facet', nextFacet);
    router.replace(params.size > 0 ? `/library?${params.toString()}` : '/library');
  };

  useEffect(() => {
    if (status !== 'connected') return;
    setLoading(true);
    setFailed(false);
    void readLibrary(query).then(setPage).catch(() => setFailed(true)).finally(() => setLoading(false));
  }, [query, readLibrary, retryCount, status]);
  const nextCursor = page?.cursor;
  const items: readonly LibraryWork[] = page?.items.map((item) => ({
    coverSrc: item.coverUrl,
    href: item.sourceUrl,
    id: item.workId,
    mediaType: item.mediaKind === 'anime' ? 'Anime' : 'Manga',
    progress: item.progressLabel,
    source: item.sourceUrl ? new URL(item.sourceUrl).hostname : 'Source locale',
    title: item.title,
  })) ?? [];

  if (status !== 'connected') return <WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>;
  const filtered = search.length > 0 || facet !== 'all';
  const state: LibraryState = failed ? 'error' : loading ? 'loading' : page && items.length === 0 && !filtered ? 'empty' : 'ready';

  return <Library
    filterOptions={filterOptions}
    filters={filters}
    hasMore={Boolean(page?.hasMore && nextCursor)}
    items={items}
    navigation={navigation}
    onChangeFilters={setQuery}
    onDownloadExtension={() => router.push('/download')}
    onLoadMore={() => { if (!nextCursor) return; const params = new URLSearchParams(searchParams.toString()); params.set('cursor', nextCursor); router.push(`/library?${params.toString()}`); }}
    onOpenRecovery={() => setRetryCount((count) => count + 1)}
    onRetry={() => setRetryCount((count) => count + 1)}
    state={state}
  />;
}

export default function LibraryPage() {
  return <WebBridgeProvider><Suspense fallback={<WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>}><LibrarySurface /></Suspense></WebBridgeProvider>;
}
