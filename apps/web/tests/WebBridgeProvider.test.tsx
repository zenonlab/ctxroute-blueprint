import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebBridgeProvider, useWebBridge } from '../app/components/WebBridgeProvider';
import { webProtocolVersion } from '@tobirink/contracts/web-bridge';

function Probe() {
  const { bootstrap, status } = useWebBridge();
  return <output data-testid="bridge-status">{`${status}:${bootstrap?.libraryCount ?? '-'}`}</output>;
}

type BridgeReply = 'connected' | 'incompatible' | 'invalid-bootstrap';

function respondAs(reply: BridgeReply) {
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
    const value = request.type === 'bootstrap.read'
      ? reply === 'invalid-bootstrap'
        ? { libraryCount: 'invalid' }
        : { availability: 'connected', generation: 1, libraryCount: 7, pendingReviewCount: 0, protocolVersion: webProtocolVersion }
      : { candidates: [], context: 'local' };
    queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { requestId: request.requestId, response: { ok: true, requestId: request.requestId, type: 'tobirink.webbridge.response', value }, type: 'tobirink.webbridge.response' }, origin: window.location.origin, source: window })));
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
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
  vi.useRealTimers();
});

describe('WebBridgeProvider', () => {
  it('reports a missing extension after the five-second detection bound', async () => {
    vi.useFakeTimers();
    render(<WebBridgeProvider><Probe /></WebBridgeProvider>);
    expect(screen.getByTestId('bridge-status').textContent).toBe('loading:-');
    await act(async () => vi.advanceTimersByTimeAsync(5_001));
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
