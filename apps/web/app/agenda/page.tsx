'use client';

import { Agenda, createAgendaDays, createLocalAgendaPeriod } from '@tobirink/ui';
import type { AgendaPeriodItem, AgendaState } from '@tobirink/ui';
import type { WebAgendaPeriod } from '@tobirink/contracts/web-bridge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BridgeState, WebMemberShell, useWebMemberNavigation } from '../components/SiteShell';
import { WebBridgeProvider, useWebBridge } from '../components/WebBridgeProvider';

function dateAfter(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function AgendaSurface() {
  const navigation = useWebMemberNavigation();
  const { readAgenda, status } = useWebBridge();
  const [weekOffset, setWeekOffset] = useState(0);
  const [snapshot, setSnapshot] = useState<WebAgendaPeriod>();
  const [failed, setFailed] = useState(false);
  const requestedPeriodRef = useRef('');
  const period = useMemo(() => createLocalAgendaPeriod(new Date(), weekOffset), [weekOffset]);
  const from = period.days[0]?.id ?? '';
  const to = dateAfter(from, 7);

  useEffect(() => {
    if (status !== 'connected') return;
    const periodKey = `${from}/${to}`;
    if (requestedPeriodRef.current === periodKey) return;
    requestedPeriodRef.current = periodKey;
    setSnapshot(undefined);
    setFailed(false);
    void readAgenda(from, to).then(setSnapshot).catch(() => setFailed(true));
  }, [from, readAgenda, status, to]);

  if (status === 'loading' || status === 'reconnecting') return <WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>;
  if (status === 'extension-missing') return <Agenda canNext={false} canPrevious={false} days={createAgendaDays(period, { items: [] })} navigation={navigation} onNext={() => undefined} onPrevious={() => undefined} onRetry={() => undefined} periodLabel={period.label} state="empty" updatedAt="" />;
  const items: AgendaPeriodItem[] = snapshot?.entries.map((entry) => ({
    availability: entry.availability,
    id: `${entry.workId}_${entry.occursAt}`,
    occursAt: entry.occursAt,
    release: entry.releaseLabel,
    source: entry.sourceLabel ?? 'Source locale',
    sourceUrl: entry.sourceUrl,
    title: entry.title,
  })) ?? [];
  const agendaState: AgendaState = failed ? 'error' : !snapshot ? 'loading' : items.length === 0 ? 'empty' : items.some((item) => item.availability === 'estimated') ? 'partial' : 'ready';
  const retry = () => {
    requestedPeriodRef.current = `${from}/${to}`;
    setSnapshot(undefined);
    setFailed(false);
    void readAgenda(from, to).then(setSnapshot).catch(() => setFailed(true));
  };
  return <Agenda canNext canPrevious days={createAgendaDays(period, { items })} navigation={navigation} onNext={() => setWeekOffset((offset) => offset + 1)} onPrevious={() => setWeekOffset((offset) => offset - 1)} onRetry={retry} periodLabel={period.label} state={agendaState} updatedAt={new Intl.DateTimeFormat('fr-FR').format(new Date())} />;
}

export default function AgendaPage() {
  return <WebBridgeProvider><AgendaSurface /></WebBridgeProvider>;
}
