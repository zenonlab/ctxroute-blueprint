import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemberNavigationConfig, MemberNavigationItemId } from '@tobirink/ui';
import type { ReviewDecision } from '@tobirink/ui';
import { openSearchMessage, readReviewCandidatesMessage, readReviewQueueMessage, writeReviewDecisionMessage } from './messages';
import { createLocalReviewNavigation } from './review-navigation-model';
import type { LocalReviewCandidateState, LocalReviewQueueState } from './review-navigation-model';

export function useLocalReviewNavigation(activeId?: MemberNavigationItemId): MemberNavigationConfig {
  const [loadKey, setLoadKey] = useState(0);
  const [index, setIndex] = useState(0);
  const [queue, setQueue] = useState<LocalReviewQueueState>({ state: 'loading' });
  const [candidates, setCandidates] = useState<LocalReviewCandidateState>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const retry = useCallback(() => setLoadKey((key) => key + 1), []);

  useEffect(() => {
    let active = true;
    setQueue({ state: 'loading' });
    void readReviewQueueMessage().then((snapshot) => {
      if (!active) return;
      setIndex((current) => Math.min(current, Math.max(0, snapshot.items.length - 1)));
      setQueue({ snapshot, state: 'ready' });
    }).catch(() => {
      if (active) setQueue({ state: 'error' });
    });
    return () => { active = false; };
  }, [loadKey]);

  const selectedId = queue.state === 'ready' ? queue.snapshot.items[index]?.id : undefined;
  useEffect(() => {
    let active = true;
    setCandidates({ state: 'loading' });
    if (!selectedId) return () => { active = false; };
    void readReviewCandidatesMessage(selectedId).then((snapshot) => {
      if (active) setCandidates({ snapshot, state: 'ready' });
    }).catch(() => {
      if (active) setCandidates({ state: 'error' });
    });
    return () => { active = false; };
  }, [loadKey, selectedId]);

  const submitDecision = useCallback((decision: ReviewDecision) => {
    if (!selectedId || busy) return;
    setBusy(true);
    const localDecision = decision.kind === 'candidate'
      ? { kind: 'candidate' as const, workId: decision.candidateId }
      : decision.kind === 'manual'
        ? decision
        : { kind: 'none' as const };
    void writeReviewDecisionMessage({ decision: localDecision, reviewId: selectedId, revision: decision.revision })
      .then((result) => {
        if (result.ok) setLoadKey((key) => key + 1);
        else setCandidates({ state: result.error === 'conflict' ? 'conflict' : 'error' });
      })
      .catch(() => setCandidates({ state: 'error' }))
      .finally(() => setBusy(false));
  }, [busy, selectedId]);

  const review = useMemo(() => createLocalReviewNavigation(queue, index, {
    onIndexChange: setIndex,
    onRetry: retry,
    onSubmitDecision: submitDecision,
  }, candidates), [candidates, index, queue, retry, submitDecision]);

  const onSearch = useCallback((query: string) => {
    if (query) void openSearchMessage(query);
  }, []);

  const configuredReview = useMemo(() => ({ ...review, resolver: { ...review.resolver, busy } }), [busy, review]);

  return activeId === undefined
    ? { onSearch, review: configuredReview }
    : { activeId, onSearch, review: configuredReview };
}
