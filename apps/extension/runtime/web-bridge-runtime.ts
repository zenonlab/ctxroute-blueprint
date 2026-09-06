import { assertWebBridgeMessageSize, parseWebRequestEnvelope, webBridgeSessionDurationMs, webProtocolVersion } from '@tobirink/contracts/web-bridge';
import type { WebAgendaPeriod, WebBootstrapSnapshot, WebLibraryPage, WebRequest, WebReviewSnapshot } from '@tobirink/contracts/web-bridge';
import type { ExtensionMessage } from './messages';

type WebBridgeMessage = Extract<ExtensionMessage, { type: 'webbridge.handshake' | 'webbridge.request' }>;
export type WebBridgeValue = WebAgendaPeriod | WebBootstrapSnapshot | WebLibraryPage | WebReviewSnapshot | { error: string };
export type WebBridgeRequestHandler = (request: WebRequest) => Promise<WebBridgeValue>;

interface WebBridgeSession {
  expiresAt: number;
  origin: string;
  requestIds: Set<string>;
}

export interface WebBridgeRuntimeOptions {
  createNonce?: () => string;
  now?: () => number;
}

function senderMatchesOrigin(sender: { url?: string }, expectedOrigin: string) {
  if (!expectedOrigin || !sender.url) return false;
  try { return new URL(sender.url).origin === expectedOrigin; } catch { return false; }
}

export function createWebBridgeRuntime(handleRequest: WebBridgeRequestHandler, options: WebBridgeRuntimeOptions = {}) {
  const sessions = new Map<string, WebBridgeSession>();
  const now = options.now ?? Date.now;
  const createNonce = options.createNonce ?? (() => crypto.randomUUID());
  const error = (reason: string, requestId?: string) => {
    if (requestId) {
      const response = { error: reason, ok: false as const, requestId, type: 'tobirink.webbridge.response' as const };
      assertWebBridgeMessageSize(JSON.stringify(response));
      return response;
    }
    const response = { error: reason, ok: false as const, type: 'tobirink.webbridge.response' as const };
    assertWebBridgeMessageSize(JSON.stringify(response));
    return response;
  };

  return async (message: WebBridgeMessage, sender: { url?: string }, expectedOrigin: string) => {
    const requestId = message.type === 'webbridge.handshake' ? message.handshake.requestId : message.envelope.request.requestId;
    try {
      assertWebBridgeMessageSize(JSON.stringify(message));
      if (!senderMatchesOrigin(sender, expectedOrigin)) return error('invalid-web-origin', requestId);
      if (message.type === 'webbridge.handshake') {
        if (message.handshake.origin !== expectedOrigin) return error('invalid-web-origin', requestId);
        const nonce = createNonce();
        const expiresAt = now() + webBridgeSessionDurationMs;
        sessions.set(nonce, { expiresAt, origin: expectedOrigin, requestIds: new Set([requestId]) });
        const response = { expiresAt, nonce, ok: true as const, protocolVersion: webProtocolVersion, requestId, type: 'tobirink.webbridge.response' as const };
        assertWebBridgeMessageSize(JSON.stringify(response));
        return response;
      }
      const envelope = parseWebRequestEnvelope(message.envelope, expectedOrigin, now());
      const session = sessions.get(envelope.nonce);
      if (!session) return error('unknown-web-session', requestId);
      if (session.origin !== expectedOrigin || session.expiresAt !== envelope.expiresAt || session.expiresAt <= now()) {
        sessions.delete(envelope.nonce);
        return error('expired-web-session', requestId);
      }
      if (session.requestIds.has(requestId)) return error('replayed-web-request', requestId);
      session.requestIds.add(requestId);
      const value = await handleRequest(envelope.request);
      const response = { ok: true as const, requestId, type: 'tobirink.webbridge.response' as const, value };
      assertWebBridgeMessageSize(JSON.stringify(response));
      return response;
    } catch (caught) {
      return error(caught instanceof Error && caught.message === 'webbridge-message-too-large' ? caught.message : 'invalid-web-envelope', requestId);
    }
  };
}
