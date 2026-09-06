'use client';

import { Button, FeedbackState, LibraryFilters, Status, WorkCard } from '@tobirink/ui';
import type { LibraryFiltersValue } from '@tobirink/ui';
import type { WebLibraryPage, WebLibraryQuery } from '@tobirink/contracts/web-bridge';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { BridgeState, SiteShell } from '../components/SiteShell';
import { useWebBridge } from '../components/WebBridgeProvider';

const typeOptions = [{ label: 'Anime', value: 'anime' }, { label: 'Manga', value: 'manga' }] as const;
const filterOptions = { progress: [], status: [], type: typeOptions } as const;

function LibrarySurface() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { readLibrary, status } = useWebBridge();
  const [page, setPage] = useState<WebLibraryPage>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const search = searchParams.get('search')?.slice(0, 120) ?? '';
  const facetValue = searchParams.get('facet');
  const facet: WebLibraryQuery['facet'] = facetValue === 'anime' || facetValue === 'manga' ? facetValue : 'all';
  const cursor = searchParams.get('cursor')?.slice(0, 128) || undefined;
  const query = useMemo<WebLibraryQuery>(() => ({ cursor, facet, limit: 24, search: search || undefined }), [cursor, facet, search]);
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

  return <main className="member-page"><header className="member-hero compact"><p className="eyebrow">Collection locale</p><h1>Bibliothèque</h1><p>Recherche accent-insensible et facette sont appliquées à votre projection privée, par pages de 24 œuvres au plus.</p></header>
    {status !== 'connected' ? <BridgeState /> : <>
      <LibraryFilters disabled={loading} onChange={setQuery} options={filterOptions} value={filters} />
      {loading && !page ? <FeedbackState kind="loading" title="Lecture de la bibliothèque…" description="La projection locale est en cours." /> : null}
      {failed ? <FeedbackState action={<Button onClick={() => setRetryCount((count) => count + 1)} icon="refresh-cw">Réessayer</Button>} kind="error" recoverable title="Bibliothèque indisponible" description="Aucune donnée locale n’a été modifiée." /> : null}
      {!loading && !failed && page?.items.length === 0 ? <FeedbackState kind="empty" title={search || facet !== 'all' ? 'Aucune œuvre trouvée' : 'Bibliothèque vide'} description={search || facet !== 'all' ? 'Modifiez la recherche ou la facette.' : 'Importez vos favoris depuis l’extension.'} /> : null}
      {page?.items.length ? <section aria-busy={loading || undefined} aria-label="Œuvres de la bibliothèque" className="work-grid">{page.items.map((item) => <WorkCard coverSrc={item.coverUrl} context={item.mediaKind === 'anime' ? 'Anime' : 'Manga'} detail={item.progressLabel ?? 'Progression non renseignée'} href={item.sourceUrl} indicator={item.progressLabel} key={item.workId} title={item.title} variant="library" />)}</section> : null}
      {page ? <nav aria-label="Pagination de la bibliothèque" className="pagination"><Status tone="neutral">{`${page.items.length} œuvre${page.items.length > 1 ? 's' : ''} sur cette page`}</Status>{page.hasMore && nextCursor ? <Button icon="arrow-right" iconPosition="end" onClick={() => { const params = new URLSearchParams(searchParams.toString()); params.set('cursor', nextCursor); router.push(`/library?${params.toString()}`); }}>Page suivante</Button> : null}</nav> : null}
    </>}
  </main>;
}

export default function LibraryPage() {
  return <SiteShell><Suspense fallback={<main className="member-page"><FeedbackState kind="loading" title="Préparation de la bibliothèque…" /></main>}><LibrarySurface /></Suspense></SiteShell>;
}
