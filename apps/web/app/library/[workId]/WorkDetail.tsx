'use client';

import { WorkCard } from '@tobirink/ui';
import type { WebLibraryPage } from '@tobirink/contracts/web-bridge';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BridgeState, WebMemberShell } from '../../components/SiteShell';
import { WebBridgeProvider, useWebBridge } from '../../components/WebBridgeProvider';

function WorkDetailSurface() {
  const searchParams = useSearchParams();
  const workId = searchParams.get('work');
  const { readLibrary, status } = useWebBridge();
  const [page, setPage] = useState<WebLibraryPage>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status !== 'connected' || !workId?.startsWith('work_')) return;
    setFailed(false);
    void readLibrary({ facet: 'all', limit: 1, sort: 'ADDED_DESC', workId }).then(setPage).catch(() => setFailed(true));
  }, [readLibrary, status, workId]);

  if (status !== 'connected' || failed || !workId) return <WebMemberShell><main className="member-state-page"><BridgeState /></main></WebMemberShell>;
  const item = page?.items[0];
  if (!item) return <WebMemberShell><main className="member-state-page" aria-busy={!page}><p>{page ? 'Œuvre locale introuvable.' : 'Chargement de la fiche locale…'}</p></main></WebMemberShell>;
  const details = [item.format, item.startYear, item.editorialStatus, item.provider].filter(Boolean).join(' · ');
  return (
    <WebMemberShell>
      <main aria-label={`Fiche de ${item.title}`} className="member-state-page">
        <WorkCard
          coverAlt={item.coverAttribution ? `Couverture de ${item.title} — ${item.coverAttribution}` : undefined}
          coverSrc={item.coverUrl}
          coverFallbackSrc={item.coverFallbackUrl}
          context={item.mediaKind === 'anime' ? 'Anime' : 'Manga'}
          detail={details || 'Fiche locale'}
          href={item.sourceUrl ?? item.canonicalUrl}
          indicator={item.progressLabel}
          title={item.title}
          variant="library"
        />
      </main>
    </WebMemberShell>
  );
}

export function WorkDetail() {
  return <WebBridgeProvider><WorkDetailSurface /></WebBridgeProvider>;
}
