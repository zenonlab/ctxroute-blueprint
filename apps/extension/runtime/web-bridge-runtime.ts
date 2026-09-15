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

const webBridgeSessionLimit = 32;
const webBridgeRequestIdLimit = 512;
const webBridgeSessionRequestIdLimit = 64;

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
  let requestIdCount = 0;
  const now = options.now ?? Date.now;
  const createNonce = options.createNonce ?? (() => crypto.randomUUID());
  const removeSession = (nonce: string) => {
    const session = sessions.get(nonce);
    if (!session) return;
    requestIdCount -= session.requestIds.size;
    sessions.delete(nonce);
  };
  const purgeExpiredSessions = (timestamp: number) => {
    for (const [nonce, session] of sessions) if (session.expiresAt <= timestamp) removeSession(nonce);
  };
  const evictLeastRecentlyUsedSession = (protectedNonce?: string) => {
    let nonce: string | undefined;
    for (const candidate of sessions.keys()) {
      if (candidate !== protectedNonce) { nonce = candidate; break; }
    }
    if (nonce === undefined) return false;
    removeSession(nonce);
    return true;
  };
  const touchSession = (nonce: string, session: WebBridgeSession) => {
    sessions.delete(nonce);
    sessions.set(nonce, session);
  };
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
      const timestamp = now();
      purgeExpiredSessions(timestamp);
      if (message.type === 'webbridge.handshake') {
        if (message.handshake.origin !== expectedOrigin) return error('invalid-web-origin', requestId);
        const nonce = createNonce();
        removeSession(nonce);
        while (sessions.size >= webBridgeSessionLimit || requestIdCount >= webBridgeRequestIdLimit) evictLeastRecentlyUsedSession();
        const expiresAt = timestamp + webBridgeSessionDurationMs;
        sessions.set(nonce, { expiresAt, origin: expectedOrigin, requestIds: new Set([requestId]) });
        requestIdCount += 1;
        const response = { expiresAt, nonce, ok: true as const, protocolVersion: webProtocolVersion, requestId, type: 'tobirink.webbridge.response' as const };
        assertWebBridgeMessageSize(JSON.stringify(response));
        return response;
      }
      const envelope = parseWebRequestEnvelope(message.envelope, expectedOrigin, timestamp);
      const session = sessions.get(envelope.nonce);
      if (!session) return error('unknown-web-session', requestId);
      if (session.origin !== expectedOrigin || session.expiresAt !== envelope.expiresAt || session.expiresAt <= timestamp) {
        removeSession(envelope.nonce);
        return error('expired-web-session', requestId);
      }
      if (session.requestIds.has(requestId)) return error('replayed-web-request', requestId);
      if (session.requestIds.size >= webBridgeSessionRequestIdLimit) {
        removeSession(envelope.nonce);
        return error('webbridge-session-quota', requestId);
      }
      while (requestIdCount >= webBridgeRequestIdLimit && evictLeastRecentlyUsedSession(envelope.nonce)) {}
      if (requestIdCount >= webBridgeRequestIdLimit) {
        removeSession(envelope.nonce);
        return error('webbridge-global-quota', requestId);
      }
      session.requestIds.add(requestId);
      requestIdCount += 1;
      touchSession(envelope.nonce, session);
      const value = await handleRequest(envelope.request);
      const response = { ok: true as const, requestId, type: 'tobirink.webbridge.response' as const, value };
      assertWebBridgeMessageSize(JSON.stringify(response));
      return response;
    } catch (caught) {
      return error(caught instanceof Error && caught.message === 'webbridge-message-too-large' ? caught.message : 'invalid-web-envelope', requestId);
    }
  };
}
