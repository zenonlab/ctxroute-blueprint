'use client';

import { Button, FeedbackState, Status, WorkCard, createAgendaDays, createLocalAgendaPeriod } from '@tobirink/ui';
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
    source: entry.sourceLabel ?? 'Source locale',
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
    void Promise.all([readLibrary({ facet: 'all', limit: 4 }), readAgenda(from, dateAfter(from, 7))])
      .then(([nextLibrary, nextAgenda]) => { setLibrary(nextLibrary); setAgenda(nextAgenda); })
      .catch(() => setFailed(true));
  }, [period, readAgenda, readLibrary, retryCount, status]);

  if (status !== 'connected') return <section className="member-intro"><BridgeState /></section>;
  if (failed) return <section className="member-section"><FeedbackState action={<Button icon="refresh-cw" onClick={() => setRetryCount((count) => count + 1)}>Réessayer</Button>} kind="error" recoverable title="Aperçu local indisponible" description="La bibliothèque et l’agenda restent intacts dans l’extension." /></section>;
  if (!library || !agenda) return <section className="member-section"><FeedbackState kind="loading" title="Préparation de votre espace…" description="Lecture des projections locales de la bibliothèque et de la semaine." /></section>;
  const days = agendaDays(period, agenda);
  return <>
    <section className="member-section" aria-labelledby="library-overview-title">
      <header className="section-heading"><div><p className="eyebrow">Bibliothèque locale</p><h2 id="library-overview-title">{bootstrap?.libraryCount ?? library.items.length} œuvres</h2></div><a className="text-link" href="/library">Tout voir</a></header>
      {library.items.length === 0
        ? <FeedbackState kind="empty" title="Bibliothèque vide" description="Importez vos favoris depuis l’extension pour commencer." />
        : <div className="work-grid">{library.items.map((item) => <WorkCard coverSrc={item.coverUrl} context={item.mediaKind === 'anime' ? 'Anime' : 'Manga'} detail={item.progressLabel ?? 'Progression non renseignée'} href={item.sourceUrl} key={item.workId} title={item.title} variant="library" />)}</div>}
    </section>
    <section className="member-section" aria-labelledby="agenda-overview-title">
      <header className="section-heading"><div><p className="eyebrow">Semaine locale</p><h2 id="agenda-overview-title">{period.label}</h2></div><a className="text-link" href="/agenda">Ouvrir l’agenda</a></header>
      {agenda.entries.some((entry) => entry.availability === 'estimated') ? <Status tone="accent">La semaine contient des horaires estimés</Status> : null}
      <div aria-label={`Aperçu Agenda · ${period.label}`} className="agenda-preview" tabIndex={0}>{days.map((day) => <section className="agenda-preview-day" key={day.id}><header><strong>{day.label}</strong><span>{day.displayDate}</span></header>{day.releases.map((release) => <WorkCard context={release.availability === 'estimated' ? 'Estimation' : release.availability === 'official' ? 'Officielle' : 'Confirmée'} detail={`${release.release} · ${release.source}`} href={release.href} indicator={release.displayDate} key={release.id} title={release.title} variant="agenda" />)}</section>)}</div>
    </section>
  </>;
}

export default function HomePage() {
  return <SiteShell><main className="member-page"><header className="member-hero"><p className="eyebrow">Tobirink Workbench</p><h1>Reprendre le fil.</h1><p>Votre bibliothèque et vos sorties restent sur cet appareil, projetées par l’extension uniquement pendant cette session.</p></header><HomePrivateOverview /></main></SiteShell>;
}
