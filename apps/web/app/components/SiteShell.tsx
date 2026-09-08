'use client';

import { Button, FeedbackState, MemberNavigation, Status } from '@tobirink/ui';
import type { MemberNavigationConfig, ReviewDecision, ReviewResolverProps } from '@tobirink/ui';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import logo from '../../../extension/public/icons/tobirink-128.png';
import { WebBridgeProvider, useWebBridge } from './WebBridgeProvider';

const memberRoutes = { agenda: '/agenda', brand: '/', home: '/', library: '/library' } as const;

function activeNavigation(pathname: string) {
  if (pathname === '/agenda') return 'agenda' as const;
  if (pathname.startsWith('/library')) return 'library' as const;
  return 'home' as const;
}

export function useWebMemberNavigation(): MemberNavigationConfig {
  const router = useRouter();
  const pathname = usePathname();
  const { bootstrap, decideReview, refreshReview, retry, review, status } = useWebBridge();
  const reviewItem = review?.reviewId && review.revision ? {
    candidates: review.candidates.map((candidate) => ({
      candidateId: candidate.workId ?? candidate.candidateId,
      href: candidate.sourceUrl,
      mediaType: candidate.mediaKind,
      provider: new URL(candidate.sourceUrl).hostname,
      providerId: candidate.workId ?? candidate.candidateId,
      title: candidate.title,
    })),
    id: review.reviewId,
    reason: review.reason,
    matchLevel: review.matchLevel,
    provenance: review.provenance,
    totalCandidates: review.totalCandidates,
    revision: review.revision,
    sourceLabel: 'Favori enregistré',
    title: review.title ?? 'Correspondance à vérifier',
  } : undefined;
  const submitDecision = (decision: ReviewDecision) => {
    if (!review?.reviewId) return;
    const command = decision.kind === 'candidate'
      ? { decision: { kind: 'candidate' as const, workId: decision.candidateId }, reviewId: review.reviewId, revision: decision.revision }
      : decision.kind === 'manual'
        ? { decision: { kind: 'manual' as const, source: decision.source, value: decision.value }, reviewId: review.reviewId, revision: decision.revision }
        : { decision: { kind: decision.kind }, reviewId: review.reviewId, revision: decision.revision };
    void decideReview(command);
  };
  const resolver: ReviewResolverProps = {
    canNext: false,
    canPrevious: false,
    extensionRequired: status === 'extension-missing',
    item: reviewItem,
    onNext: () => undefined,
    onDownloadExtension: () => router.push('/download'),
    onPrevious: () => undefined,
    onRefresh: () => void refreshReview(),
    onRetry: status === 'connected' ? () => void refreshReview() : retry,
    onSubmitDecision: submitDecision,
    state: status === 'loading' || status === 'reconnecting' ? 'loading' : reviewItem ? 'ready' : status === 'connected' || status === 'extension-missing' ? 'empty' : 'error',
  };
  return {
    activeId: activeNavigation(pathname),
    logoSrc: logo.src,
    onSearch: (query) => router.push(query ? `/library?search=${encodeURIComponent(query)}` : '/library'),
    review: { count: bootstrap?.pendingReviewCount ?? 0, resolver },
    routes: memberRoutes,
  };
}

export function WebMemberShell({ children }: Readonly<{ children: ReactNode }>) {
  const navigation = useWebMemberNavigation();
  return <MemberNavigation {...navigation}>{children}</MemberNavigation>;
}

export function SiteShell({ children }: Readonly<{ children: ReactNode }>) {
  return <WebBridgeProvider><WebMemberShell>{children}</WebMemberShell></WebBridgeProvider>;
}

export function BridgeState() {
  const router = useRouter();
  const { retry, status } = useWebBridge();
  if (status === 'connected') return <Status tone="success">Extension connectée · vue privée disponible</Status>;
  if (status === 'loading' || status === 'reconnecting') {
    return <FeedbackState description="Connexion à votre extension en cours." kind="loading" layout="centered" title={status === 'loading' ? 'Ouverture de votre bibliothèque…' : 'Reconnexion à l’extension…'} />;
  }
  if (status === 'extension-missing') {
    return <FeedbackState action={<Button icon="download" onClick={() => router.push('/download')} variant="primary">Télécharger l’extension</Button>} description="Installez l’extension TobiRink pour retrouver votre bibliothèque et vos sorties." icon="puzzle" kind="empty" layout="centered" title="Extension requise" />;
  }
  return <FeedbackState action={status === 'incompatible' ? <Button icon="download" onClick={() => router.push('/download')} variant="primary">Télécharger la version actuelle</Button> : <Button icon="refresh-cw" onClick={retry}>Réessayer</Button>} description={status === 'incompatible' ? 'Cette version ne peut pas communiquer avec le site.' : 'Vos données privées restent intactes dans l’extension.'} kind="error" layout="centered" recoverable title={status === 'incompatible' ? 'Extension incompatible' : 'Connexion interrompue'} />;
}
