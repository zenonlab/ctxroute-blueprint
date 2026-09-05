import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MemberNavigationConfig, MemberNavigationItemId } from '@tobirink/ui';
import { readReviewQueueMessage } from './messages';
import { createLocalReviewNavigation } from './review-navigation-model';
import type { LocalReviewQueueState } from './review-navigation-model';

const ignoreSearch = () => undefined;

export function useLocalReviewNavigation(activeId?: MemberNavigationItemId): MemberNavigationConfig {
  const [loadKey, setLoadKey] = useState(0);
  const [index, setIndex] = useState(0);
  const [queue, setQueue] = useState<LocalReviewQueueState>({ state: 'loading' });
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

  const review = useMemo(() => createLocalReviewNavigation(queue, index, {
    onIndexChange: setIndex,
    onRetry: retry,
    onUnavailableDecision: retry,
  }), [index, queue, retry]);

  return activeId === undefined
    ? { onSearch: ignoreSearch, review }
    : { activeId, onSearch: ignoreSearch, review };
}
