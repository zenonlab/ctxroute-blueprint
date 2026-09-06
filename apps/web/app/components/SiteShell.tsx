'use client';

import { MemberNavigation } from '@tobirink/ui';
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
    state: status === 'loading' || status === 'reconnecting' ? 'loading' : reviewItem ? 'ready' : status === 'connected' ? 'empty' : 'offline',
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
  const labels = {
    connected: 'Extension connectée · vue locale disponible.',
    'extension-missing': 'Extension absente · installez-la pour ouvrir vos vues privées.',
    incompatible: 'Extension incompatible · installez la version actuelle de TobiRink.',
    loading: 'Connexion à l’extension…',
    reconnecting: 'Reconnexion à l’extension…',
    error: 'Connexion interrompue · vos données locales restent intactes.',
  } as const;
  return (
    <div className="bridge-state" data-bridge-state={status} role="status">
      <span aria-hidden="true" className={`bridge-dot${status === 'connected' ? ' ready' : ''}`} />
      <span>{labels[status]}</span>
      {status === 'error' || status === 'extension-missing' || status === 'incompatible'
        ? <button className="bridge-retry" onClick={retry} type="button">Réessayer</button>
        : null}
    </div>
  );
}
