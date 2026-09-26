import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebBridgeProvider, useWebBridge } from '../app/components/WebBridgeProvider';
import { webProtocolVersion } from '@tobirink/contracts/web-bridge';

function Probe() {
  const { bootstrap, status } = useWebBridge();
  return <output data-testid="bridge-status">{`${status}:${bootstrap?.libraryCount ?? '-'}`}</output>;
}

type BridgeReply = 'connected' | 'incompatible' | 'invalid-bootstrap';
const responders: (() => void)[] = [];

function respondAs(reply: BridgeReply, onRequest?: (request: { type: string; includeProviderReferences?: boolean }) => 'ignore' | 'error' | undefined) {
  const listener = (event: MessageEvent) => {
    const message = event.data;
    if (message?.type === 'webbridge.handshake') {
      const response = {
        expiresAt: Date.now() + 60_000,
        nonce: 'extension_session_nonce',
        ok: true,
        protocolVersion: reply === 'incompatible' ? 1 : webProtocolVersion,
        requestId: message.requestId,
        type: 'tobirink.webbridge.response',
      };
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: message.requestId, response, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
      return;
    }
    const request = message?.request;
    if (!request?.requestId) return;
    const action = onRequest?.(request);
    if (action === 'ignore') return;
    const value = request.type === 'bootstrap.read'
      ? reply === 'invalid-bootstrap'
        ? { libraryCount: 'invalid' }
        : { availability: 'connected', generation: 1, libraryCount: 7, pendingReviewCount: 0, protocolVersion: webProtocolVersion }
      : request.includeProviderReferences
        ? { candidates: [], context: 'local', reviewId: 'review_synthetic', revision: 'review-v1-current', providerReferences: [{ provider: 'mangaupdates', externalId: '123' }, { provider: 'mangaupdates', externalId: '456' }] }
        : { candidates: [], context: 'local' };
    const response = action === 'error'
      ? { ok: false, requestId: request.requestId, type: 'tobirink.webbridge.response', error: 'webbridge-transport-unavailable' }
      : { ok: true, requestId: request.requestId, type: 'tobirink.webbridge.response', value };
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: request.requestId, response, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
  };
  window.addEventListener('message', listener);
  const dispose = () => window.removeEventListener('message', listener);
  responders.push(dispose);
  return dispose;
}

function respondWithExpiringSessions() {
  let handshakes = 0;
  const listener = (event: MessageEvent) => {
    const message = event.data;
    if (message?.type === 'webbridge.handshake') {
      handshakes += 1;
      const response = {
        expiresAt: Date.now() + 100,
        nonce: `extension_session_nonce_${handshakes}`,
        ok: true,
        protocolVersion: webProtocolVersion,
        requestId: message.requestId,
        type: 'tobirink.webbridge.response',
      };
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: message.requestId, response, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
      return;
    }
    const request = message?.request;
    if (!request?.requestId) return;
    const value = request.type === 'bootstrap.read'
      ? { availability: 'connected', generation: handshakes, libraryCount: 7, pendingReviewCount: 0, protocolVersion: webProtocolVersion }
      : { candidates: [], context: 'local' };
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: request.requestId, response: { ok: true, requestId: request.requestId, type: 'tobirink.webbridge.response', value }, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
  };
  window.addEventListener('message', listener);
  return {
    dispose: () => window.removeEventListener('message', listener),
    handshakeCount: () => handshakes,
  };
}

function respondWithFailedRenewal() {
  let handshakes = 0;
  const listener = (event: MessageEvent) => {
    const message = event.data;
    if (message?.type === 'webbridge.handshake') {
      handshakes += 1;
      const response = {
        expiresAt: Date.now() + 100,
        nonce: `extension_session_nonce_${handshakes}`,
        ok: true,
        protocolVersion: webProtocolVersion,
        requestId: message.requestId,
        type: 'tobirink.webbridge.response',
      };
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: message.requestId, response, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
      return;
    }
    const request = message?.request;
    if (!request?.requestId) return;
    const value = request.type === 'bootstrap.read' && handshakes > 1
      ? { libraryCount: 'invalid' }
      : request.type === 'bootstrap.read'
        ? { availability: 'connected', generation: 1, libraryCount: 7, pendingReviewCount: 0, protocolVersion: webProtocolVersion }
        : { candidates: [], context: 'local' };
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: request.requestId, response: { ok: true, requestId: request.requestId, type: 'tobirink.webbridge.response', value }, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
  };
  window.addEventListener('message', listener);
  return {
    dispose: () => window.removeEventListener('message', listener),
    handshakeCount: () => handshakes,
  };
}

afterEach(() => {
  cleanup();
  for (const dispose of responders.splice(0)) dispose();
  vi.useRealTimers();
});

describe('WebBridgeProvider', () => {
  it('negotiates reference reads once and falls back to a legacy extension within a bound', async () => {
    const requests: { type: string; includeProviderReferences?: boolean }[] = [];
    const dispose = respondAs('connected', (request) => {
      requests.push(request);
      return request.includeProviderReferences ? 'ignore' : undefined;
    });
    const { result } = renderHook(() => useWebBridge(), { wrapper: WebBridgeProvider });
    await waitFor(() => expect(result.current.status).toBe('connected'), { timeout: 3_000 });
    expect(requests.filter((request) => request.includeProviderReferences)).toHaveLength(1);
    expect(result.current.review).toEqual({ candidates: [], context: 'local' });
    await act(() => result.current.refreshReview());
    expect(requests.filter((request) => request.includeProviderReferences)).toHaveLength(1);
    expect(requests.filter((request) => request.type === 'review.read')).toHaveLength(3);
    act(() => result.current.retry());
    await waitFor(() => expect(requests.filter((request) => request.includeProviderReferences)).toHaveLength(2));
    await waitFor(() => expect(result.current.status).toBe('connected'), { timeout: 3_000 });
    dispose();
  });

  it('serializes same-tick decisions and refreshes reference reads after a pending write', async () => {
    const requests: { type: string; includeProviderReferences?: boolean }[] = [];
    const dispose = respondAs('connected', (request) => { requests.push(request); return undefined; });
    const { result } = renderHook(() => useWebBridge(), { wrapper: WebBridgeProvider });
    await waitFor(() => expect(result.current.status).toBe('connected'));
    const command = { decision: { kind: 'manual' as const, source: 'id' as const, value: 'mangaupdates:123' }, reviewId: 'review_synthetic', revision: 'review-v1-current' };
    await act(async () => {
      await Promise.all([result.current.decideReview(command), result.current.decideReview(command)]);
    });
    expect(requests.filter((request) => request.type === 'review.decision.write')).toHaveLength(1);
    expect(requests.filter((request) => request.includeProviderReferences)).toHaveLength(2);
    expect(result.current.review?.providerReferences).toHaveLength(2);
    expect(result.current.reviewBusy).toBe(false);
    expect(result.current.reviewPending).toBe(true);
    dispose();
  });

  it('never replays a decision when its transport fails and releases the busy guard', async () => {
    let writes = 0;
    const dispose = respondAs('connected', (request) => {
      if (request.type !== 'review.decision.write') return undefined;
      writes += 1;
      return 'error';
    });
    const { result } = renderHook(() => useWebBridge(), { wrapper: WebBridgeProvider });
    await waitFor(() => expect(result.current.status).toBe('connected'));
    await act(async () => {
      await expect(result.current.decideReview({ decision: { kind: 'none' }, reviewId: 'review_synthetic', revision: 'review-v1-current' })).rejects.toThrow('webbridge-transport-unavailable');
    });
    expect(writes).toBe(1);
    expect(result.current.reviewBusy).toBe(false);
    dispose();
  });

  it('reports a missing extension after the 1.5 second detection bound', async () => {
    vi.useFakeTimers();
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    expect(screen.getByTestId('bridge-status').textContent).toBe('loading:-');
    await act(async () => vi.advanceTimersByTimeAsync(1_501));
    expect(screen.getByTestId('bridge-status').textContent).toBe('extension-missing:-');
  });

  it('publishes only schema-validated connected projections', async () => {
    const dispose = respondAs('connected');
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('connected:7'));
    dispose();
  });

  it('distinguishes an incompatible protocol response', async () => {
    const dispose = respondAs('incompatible');
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('incompatible:-'));
    dispose();
  });

  it('rejects an invalid operation-specific projection', async () => {
    const dispose = respondAs('invalid-bootstrap');
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('error:-'));
    dispose();
  });

  it('renews every successfully expired session without disconnecting', async () => {
    const responder = respondWithExpiringSessions();
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('connected:7'));
    await waitFor(() => expect(responder.handshakeCount()).toBeGreaterThanOrEqual(3), { timeout: 1_000 });
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('connected:7'));
    responder.dispose();
  });

  it('stops after one failed automatic renewal and exposes a recoverable error', async () => {
    const responder = respondWithFailedRenewal();
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('connected:7'));
    await waitFor(() => expect(screen.getByTestId('bridge-status').textContent).toBe('error:7'), { timeout: 1_000 });
    expect(responder.handshakeCount()).toBe(2);
    responder.dispose();
  });
});
