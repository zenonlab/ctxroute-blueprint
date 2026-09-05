import type { MemberReviewConfig } from '@tobirink/ui';
import type { ReviewQueueResponse } from './messages';

type ReviewQueueSnapshot = Extract<ReviewQueueResponse, { ok: true }>['snapshot'];

export type LocalReviewQueueState =
  | { state: 'error' }
  | { state: 'loading' }
  | { snapshot: ReviewQueueSnapshot; state: 'ready' };

export interface LocalReviewNavigationCallbacks {
  onIndexChange: (index: number) => void;
  onRetry: () => void;
  onUnavailableDecision: () => void;
}

function sourceUrl(value: string): string | undefined {
  const candidate = value.trim();
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : undefined;
  } catch {
    return undefined;
  }
}

export function createLocalReviewNavigation(
  queue: LocalReviewQueueState,
  requestedIndex: number,
  callbacks: LocalReviewNavigationCallbacks,
): MemberReviewConfig {
  const shared = {
    canNext: false,
    canPrevious: false,
    onNext: callbacks.onRetry,
    onPrevious: callbacks.onRetry,
    onRefresh: callbacks.onRetry,
    onRetry: callbacks.onRetry,
    onSubmitDecision: callbacks.onUnavailableDecision,
  } as const;

  if (queue.state === 'loading' || queue.state === 'error') {
    return { count: 0, resolver: { ...shared, state: queue.state } };
  }

  const { items } = queue.snapshot;
  if (items.length === 0) return { count: 0, resolver: { ...shared, state: 'empty' } };

  const index = Math.min(Math.max(0, Math.trunc(requestedIndex)), items.length - 1);
  const source = items[index];
  if (!source) return { count: 0, resolver: { ...shared, state: 'empty' } };
  const item = {
    candidates: [],
    id: source.id,
    position: index + 1,
    revision: source.id,
    sourceLabel: source.sourceLabel,
    title: source.title,
    total: items.length,
  };
  const url = sourceUrl(source.sourceLabel);

  return {
    count: items.length,
    resolver: {
      ...shared,
      canNext: index < items.length - 1,
      canPrevious: index > 0,
      item: url ? { ...item, sourceUrl: url } : item,
      onNext: () => callbacks.onIndexChange(index + 1),
      onPrevious: () => callbacks.onIndexChange(index - 1),
      state: 'partial',
    },
  };
}
