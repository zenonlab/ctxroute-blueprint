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
  const { bootstrap, decideReview, refreshReview, review, status } = useWebBridge();
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
    revision: review.revision,
    sourceLabel: 'Favori local',
    title: review.title ?? 'Correspondance à vérifier',
  } : undefined;
  const submitDecision = (decision: ReviewDecision) => {
    if (!review?.reviewId) return;
    const command = decision.kind === 'candidate'
      ? { decision: { kind: 'candidate' as const, workId: decision.candidateId }, reviewId: review.reviewId, revision: decision.revision }
      : decision.kind === 'manual'
        ? { decision: { kind: 'manual' as const, source: decision.source, value: decision.value }, reviewId: review.reviewId, revision: decision.revision }
        : { decision: { kind: 'none' as const }, reviewId: review.reviewId, revision: decision.revision };
    void decideReview(command);
  };
  const resolver: ReviewResolverProps = {
    canNext: false,
    canPrevious: false,
    item: reviewItem,
    onNext: () => undefined,
    onPrevious: () => undefined,
    onRefresh: () => void refreshReview(),
    onRetry: () => void refreshReview(),
    onSubmitDecision: submitDecision,
    state: status === 'loading' || status === 'reconnecting' ? 'loading' : reviewItem ? 'ready' : status === 'connected' || status === 'extension-missing' ? 'empty' : 'offline',
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
  const { retry, status } = useWebBridge();
  if (status === 'connected') return <Status tone="success">Extension connectée · vue locale disponible</Status>;
  if (status === 'loading' || status === 'reconnecting') {
    return <FeedbackState description="Vos données restent dans l’extension pendant cette vérification." kind="loading" layout="centered" title={status === 'loading' ? 'Connexion à l’extension…' : 'Reconnexion à l’extension…'} />;
  }
  if (status === 'extension-missing') {
    return <FeedbackState action={<Button icon="refresh-cw" onClick={retry}>Réessayer</Button>} description="Installez TobiRink pour ouvrir vos vues privées sur cet appareil." icon="puzzle" kind="empty" layout="centered" title="Extension absente" />;
  }
  return <FeedbackState action={<Button icon="refresh-cw" onClick={retry}>Réessayer</Button>} description={status === 'incompatible' ? 'Installez la version actuelle de TobiRink.' : 'Vos données locales restent intactes dans l’extension.'} kind="error" layout="centered" recoverable title={status === 'incompatible' ? 'Extension incompatible' : 'Connexion interrompue'} />;
}
