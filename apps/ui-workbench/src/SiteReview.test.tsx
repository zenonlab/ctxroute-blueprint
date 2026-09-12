import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import { useWebMemberNavigation } from '../../web/app/components/SiteShell';
import { WebBridgeProvider } from '../../web/app/components/WebBridgeProvider';

const router = { back: vi.fn(), bfcacheId: 'test-route', forward: vi.fn(), prefetch: vi.fn(), push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };

function Wrapper({ children }: { children: ReactNode }) {
  return <AppRouterContext.Provider value={router}><PathnameContext.Provider value="/"><WebBridgeProvider>{children}</WebBridgeProvider></PathnameContext.Provider></AppRouterContext.Provider>;
}

describe('Site Review bridge', () => {
  it('preserves the terminal reason and sends an explicit no-match through the real bridge', async () => {
    const commands = vi.fn();
    const listener = (event: MessageEvent) => {
      const message = event.data;
      const handshake = message?.type === 'webbridge.handshake';
      const request = message?.request;
      if (!handshake && !request?.requestId) return;
      const requestId = handshake ? message.requestId : request.requestId;
      if (request?.type === 'review.decision.write') commands(request.command);
      const value = request?.type === 'bootstrap.read'
        ? { availability: 'connected', generation: 1, libraryCount: 0, pendingReviewCount: 1, protocolVersion: 4 }
        : { candidates: [], context: 'local', matchLevel: 'exact-title', provenance: 'provider-search', reason: 'NOT_FOUND', reviewId: 'review_synthetic', revision: 'revision-synthetic', title: 'Synthetic missing work', totalCandidates: 0 };
      const response = handshake
        ? { expiresAt: Date.now() + 60_000, nonce: 'extension_session_nonce', ok: true, protocolVersion: 4, requestId, type: 'tobirink.webbridge.response' }
        : { ok: true, requestId, type: 'tobirink.webbridge.response', value };
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId, response, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
    };
    window.addEventListener('message', listener);
    const { result, unmount } = renderHook(useWebMemberNavigation, { wrapper: Wrapper });
    try {
      await waitFor(() => expect(result.current.review.resolver.item).toMatchObject({ matchLevel: 'exact-title', provenance: 'provider-search', reason: 'NOT_FOUND', totalCandidates: 0 }));
      act(() => result.current.review.resolver.onSubmitDecision({ kind: 'none', revision: 'revision-synthetic' }));
      await waitFor(() => expect(commands).toHaveBeenLastCalledWith({ decision: { kind: 'none' }, reviewId: 'review_synthetic', revision: 'revision-synthetic' }));
    } finally {
      unmount();
      window.removeEventListener('message', listener);
    }
  });
});
