import { useEffect, useState } from 'react';
import type { WebLibraryPage, WebLibraryQuery } from '@tobirink/contracts/web-bridge';

export function useLibraryRefresh(readLibrary: (query: WebLibraryQuery) => Promise<WebLibraryPage>, connected: boolean, query: WebLibraryQuery, retryCount: number) {
  const [page, setPage] = useState<WebLibraryPage>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setFailed(false);
    const refresh = async () => {
      try {
        if (document.visibilityState !== 'hidden') {
          const result = await readLibrary(query);
          if (active) { setPage(result); setFailed(false); }
        }
      } catch { if (active) setFailed(true); }
      finally {
        if (active) { setLoading(false); timer = setTimeout(() => { void refresh(); }, 15_000); }
      }
    };
    void refresh();
    return () => { active = false; if (timer !== undefined) clearTimeout(timer); };
  }, [connected, query, readLibrary, retryCount]);
  return { page, loading, failed };
}
