'use client';

import { MemberOverview, createAgendaDays, createLocalAgendaPeriod } from '@tobirink/ui';
import type { AgendaDay } from '@tobirink/ui';
import type { WebAgendaPeriod, WebLibraryPage } from '@tobirink/contracts/web-bridge';
import { useEffect, useMemo, useState } from 'react';
import { BridgeState, SiteShell } from './components/SiteShell';
import { useWebBridge } from './components/WebBridgeProvider';

function dateAfter(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function agendaDays(period: ReturnType<typeof createLocalAgendaPeriod>, agenda?: WebAgendaPeriod): readonly AgendaDay[] {
  return createAgendaDays(period, { items: agenda?.entries.map((entry) => ({
    availability: entry.availability,
    id: `${entry.workId}_${entry.occursAt}`,
    occursAt: entry.occursAt,
    release: entry.releaseLabel,
    source: entry.sourceLabel ?? 'Source enregistrée',
    sourceUrl: entry.sourceUrl,
    title: entry.title,
  })) ?? [] });
}

function HomePrivateOverview() {
  const { bootstrap, readAgenda, readLibrary, status } = useWebBridge();
  const [library, setLibrary] = useState<WebLibraryPage>();
  const [agenda, setAgenda] = useState<WebAgendaPeriod>();
  const [failed, setFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const period = useMemo(() => createLocalAgendaPeriod(new Date(), 0), []);
  useEffect(() => {
    if (status !== 'connected') return;
    setFailed(false);
    const from = period.days[0]?.id;
    if (!from) return;
    void Promise.all([readLibrary({ facet: 'all', limit: 4, sort: 'ADDED_DESC' }), readAgenda(from, dateAfter(from, 7))])
      .then(([nextLibrary, nextAgenda]) => { setLibrary(nextLibrary); setAgenda(nextAgenda); })
      .catch(() => setFailed(true));
  }, [period, readAgenda, readLibrary, retryCount, status]);

  const loading = status === 'loading' || status === 'reconnecting' || status === 'connected' && (!library || !agenda);
  const empty = status === 'extension-missing';
  const days = agendaDays(period, agenda);
  const libraryItems = library?.items.map((item) => ({ coverSrc: item.coverUrl, href: item.sourceUrl ?? item.canonicalUrl ?? `/library/_?work=${encodeURIComponent(item.workId)}`, id: item.workId, mediaType: item.mediaKind === 'anime' ? 'Anime' : item.mediaKind === 'manga' ? 'Manga' : 'Type à déterminer', progress: item.progressLabel, source: (item.sourceUrl ? new URL(item.sourceUrl).hostname : undefined) ?? item.provider ?? 'Fiche locale', title: item.title })) ?? [];
  if (empty || status === 'incompatible' || status === 'error') return <main className="member-state-page"><BridgeState /></main>;
  return <MemberOverview agendaDays={days} agendaHref="/agenda" agendaState={failed ? 'error' : loading ? 'loading' : agenda?.entries.length === 0 ? 'empty' : 'ready'} libraryCount={bootstrap?.libraryCount ?? libraryItems.length} libraryHref="/library" libraryItems={libraryItems} libraryState={failed ? 'error' : loading ? 'loading' : libraryItems.length === 0 ? 'empty' : 'ready'} onRetry={() => setRetryCount((count) => count + 1)} periodLabel={period.label} />;
}

export default function HomePage() {
  return <SiteShell><HomePrivateOverview /></SiteShell>;
}
