import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebLibraryPage, WebLibraryQuery } from '@tobirink/contracts/web-bridge';
import { useLibraryRefresh } from '../app/library/use-library-refresh';

const query: WebLibraryQuery = { facet: 'all', limit: 24, sort: 'ADDED_DESC' };
const page: WebLibraryPage = { query, items: [], facets: { format: [], genre: [], progress: [], source: [], status: [], type: [], year: [] }, hasMore: false, total: 0, truncated: false, statistics: { completed: 0, inProgress: 0, knownMetadata: 0, notStarted: 0, total: 0 } };

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('live local library', () => {
  it('refreshes resolved works while visible and stops on unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const read = vi.fn(async () => page);
    const view = renderHook(() => useLibraryRefresh(read, true, query, 0));
    await act(async () => { await Promise.resolve(); });
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({ ...page, total: 1 });
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(view.result.current.page?.total).toBe(1);
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
