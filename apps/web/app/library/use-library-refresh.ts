import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebLibraryPage, WebLibraryQuery } from '@tobirink/contracts/web-bridge';

export function useLibraryRefresh(readLibrary: (query: WebLibraryQuery) => Promise<WebLibraryPage>, connected: boolean, query: WebLibraryQuery, retryCount: number) {
  const [page, setPage] = useState<WebLibraryPage>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const expanded = useRef(false);
  const loadingMore = useRef(false);
  useEffect(() => {
    if (!connected) return;
    generation.current += 1;
    expanded.current = false;
    const currentGeneration = generation.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPage(undefined);
    setLoading(true);
    setFailed(false);
    const refresh = async () => {
      if (expanded.current) return;
      try {
        if (document.visibilityState !== 'hidden') {
          const result = await readLibrary(query);
          if (active && generation.current === currentGeneration) { setPage(result); setFailed(false); }
        }
      } catch { if (active) setFailed(true); }
      finally {
        if (active) {
          setLoading(false);
          if (!expanded.current) timer = setTimeout(() => { void refresh(); }, 15_000);
        }
      }
    };
    void refresh();
    return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
  }, [connected, query, readLibrary, retryCount]);

  const loadMore = useCallback(async () => {
    const cursor = page?.cursor;
    if (!connected || !cursor || loadingMore.current) return;
    const currentGeneration = generation.current;
    expanded.current = true;
    loadingMore.current = true;
    setLoading(true);
    try {
      const next = await readLibrary({ ...query, cursor });
      if (generation.current !== currentGeneration) return;
      setPage((current) => {
        if (!current || current.cursor !== cursor) return current;
        const known = new Set(current.items.map(({ workId }) => workId));
        return { ...next, items: [...current.items, ...next.items.filter(({ workId }) => !known.has(workId))] };
      });
      setFailed(false);
    } catch { if (generation.current === currentGeneration) setFailed(true); }
    finally {
      loadingMore.current = false;
      if (generation.current === currentGeneration) setLoading(false);
    }
  }, [connected, page, query, readLibrary]);

  return { page, loading, failed, loadMore };
}
