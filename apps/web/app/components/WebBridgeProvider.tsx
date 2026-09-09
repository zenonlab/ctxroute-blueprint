'use client';

import {
  assertWebBridgeMessageSize,
  webAgendaPeriodSchema,
  webBootstrapSnapshotSchema,
  webBridgeSessionDurationMs,
  webHandshakeResponseSchema,
  webLibraryPageSchema,
  webHandshakeSchema,
  webPageBridgeInboundSchema,
  webProtocolVersion,
  webRequestEnvelopeSchema,
  webReviewSnapshotSchema,
} from '@tobirink/contracts/web-bridge';
import type {
  WebAgendaPeriod,
  WebBootstrapSnapshot,
  WebLibraryPage,
  WebLibraryQuery,
  WebHandshake,
  WebRequest,
  WebRequestEnvelope,
  WebReviewDecisionCommand,
  WebReviewSnapshot,
} from '@tobirink/contracts/web-bridge';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ZodType } from 'zod';

export type WebBridgeStatus = 'loading' | 'extension-missing' | 'reconnecting' | 'incompatible' | 'connected' | 'error';

interface BridgeSession {
  expiresAt: number;
  nonce: string;
}

type BridgeJson = boolean | null | number | string | BridgeJson[] | { [key: string]: BridgeJson };

interface PendingResponse {
  reject: (reason: Error) => void;
  resolve: (value: BridgeJson) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface WebBridgeContextValue {
  bootstrap?: WebBootstrapSnapshot;
  decideReview: (command: WebReviewDecisionCommand) => Promise<void>;
  readAgenda: (from: string, to: string) => Promise<WebAgendaPeriod>;
  readLibrary: (query: WebLibraryQuery) => Promise<WebLibraryPage>;
  refreshReview: () => Promise<void>;
  retry: () => void;
  review?: WebReviewSnapshot;
  status: WebBridgeStatus;
}

type WithoutRequestId<Request> = Request extends { requestId: string } ? Omit<Request, 'requestId'> : never;
type WebRequestInput = WithoutRequestId<WebRequest>;

const WebBridgeContext = createContext<WebBridgeContextValue | undefined>(undefined);
const detectionTimeoutMs = 1_500;
const requestTimeoutMs = 5_000;

function requestId() {
  return `web_${crypto.randomUUID()}`;
}

function bridgeError(reason: string) {
  return new Error(reason);
}

export function WebBridgeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [status, setStatus] = useState<WebBridgeStatus>('loading');
  const [bootstrap, setBootstrap] = useState<WebBootstrapSnapshot>();
  const [review, setReview] = useState<WebReviewSnapshot>();
  const pendingRef = useRef(new Map<string, PendingResponse>());
  const sessionRef = useRef<BridgeSession | undefined>(undefined);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const automaticReconnectUsedRef = useRef(false);
  const mountedRef = useRef(false);

  const postAndWait = useCallback((message: WebHandshake | WebRequestEnvelope, id: string, timeoutMs: number) => new Promise<BridgeJson>((resolve, reject) => {
    assertWebBridgeMessageSize(JSON.stringify(message));
    const timeout = setTimeout(() => {
      pendingRef.current.delete(id);
      reject(bridgeError('webbridge-timeout'));
    }, timeoutMs);
    pendingRef.current.set(id, { reject, resolve, timeout });
    window.postMessage(message, window.location.origin);
  }), []);

  const handshake = useCallback(async () => {
    const id = requestId();
    const message = webHandshakeSchema.parse({
      origin: window.location.origin,
      protocolVersion: webProtocolVersion,
      requestId: id,
      type: 'webbridge.handshake',
    });
    const response = webHandshakeResponseSchema.parse(await postAndWait(message, id, detectionTimeoutMs));
    if (response.requestId !== id) throw bridgeError('webbridge-correlation-mismatch');
    const maximumExpiry = Date.now() + webBridgeSessionDurationMs;
    if (response.expiresAt <= Date.now() || response.expiresAt > maximumExpiry) {
      throw bridgeError('webbridge-invalid-session-expiry');
    }
    sessionRef.current = { expiresAt: response.expiresAt, nonce: response.nonce };
    return response;
  }, [postAndWait]);

  const rawRequest = useCallback(async <T,>(request: WebRequestInput, schema: ZodType<T>): Promise<T> => {
    const session = sessionRef.current;
    if (!session || session.expiresAt <= Date.now()) throw bridgeError('expired-web-session');
    const id = requestId();
    const envelope = webRequestEnvelopeSchema.parse({
      expiresAt: session.expiresAt,
      nonce: session.nonce,
      origin: window.location.origin,
      protocolVersion: webProtocolVersion,
      request: { ...request, requestId: id },
    });
    const response = await postAndWait(envelope, id, requestTimeoutMs);
    return schema.parse(response);
  }, [postAndWait]);

  const establishConnection = useCallback(async (reconnecting: boolean) => {
    setStatus(reconnecting ? 'reconnecting' : 'loading');
    try {
      const connectedSession = await handshake();
      const [nextBootstrap, nextReview] = await Promise.all([
        rawRequest({ type: 'bootstrap.read' }, webBootstrapSnapshotSchema),
        rawRequest({ type: 'review.read' }, webReviewSnapshotSchema),
      ]);
      if (!mountedRef.current) return;
      setBootstrap(nextBootstrap);
      setReview(nextReview);
      automaticReconnectUsedRef.current = false;
      setStatus('connected');
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        if (automaticReconnectUsedRef.current) {
          sessionRef.current = undefined;
          setStatus('error');
          return;
        }
        automaticReconnectUsedRef.current = true;
        void establishConnection(true);
      }, Math.max(0, connectedSession.expiresAt - Date.now()));
    } catch (caught) {
      if (!mountedRef.current) return;
      sessionRef.current = undefined;
      const reason = caught instanceof Error ? caught.message : 'webbridge-error';
      if (reason === 'webbridge-incompatible') setStatus('incompatible');
      else if (!reconnecting && reason === 'webbridge-timeout') setStatus('extension-missing');
      else setStatus('error');
    }
  }, [handshake, rawRequest]);

  const withReconnect = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : 'webbridge-error';
      const reconnectable = reason === 'expired-web-session' || reason === 'unknown-web-session' || reason === 'webbridge-timeout';
      if (!reconnectable || automaticReconnectUsedRef.current) {
        setStatus('error');
        throw caught;
      }
      automaticReconnectUsedRef.current = true;
      await establishConnection(true);
      if (!sessionRef.current) throw caught;
      return operation();
    }
  }, [establishConnection]);

  useEffect(() => {
    mountedRef.current = true;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      try { assertWebBridgeMessageSize(JSON.stringify(event.data)); } catch { return; }
      const parsed = webPageBridgeInboundSchema.safeParse(event.data);
      if (!parsed.success) return;
      const outerRequestId = parsed.data.requestId;
      const pending = pendingRef.current.get(outerRequestId);
      if (!pending) return;
      if ('protocolVersion' in parsed.data.response && parsed.data.response.protocolVersion !== webProtocolVersion) {
        clearTimeout(pending.timeout);
        pendingRef.current.delete(outerRequestId);
        pending.reject(bridgeError('webbridge-incompatible'));
        return;
      }
      if (parsed.data.response.requestId !== outerRequestId) {
        clearTimeout(pending.timeout);
        pendingRef.current.delete(outerRequestId);
        pending.reject(bridgeError('webbridge-invalid-response'));
        return;
      }
      clearTimeout(pending.timeout);
      pendingRef.current.delete(outerRequestId);
      const response = parsed.data.response;
      if (!response.ok) pending.reject(bridgeError(response.error));
      else if ('value' in response) pending.resolve(response.value);
      else pending.resolve(response);
    };
    window.addEventListener('message', onMessage);
    void establishConnection(false);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('message', onMessage);
      clearTimeout(expiryTimerRef.current);
      for (const pending of pendingRef.current.values()) {
        clearTimeout(pending.timeout);
        pending.reject(bridgeError('webbridge-disposed'));
      }
      pendingRef.current.clear();
    };
  }, [establishConnection]);

  const refreshReview = useCallback(async () => {
    const nextReview = await withReconnect(() => rawRequest({ type: 'review.read' }, webReviewSnapshotSchema));
    setReview(nextReview);
  }, [rawRequest, withReconnect]);

  const decideReview = useCallback(async (command: WebReviewDecisionCommand) => {
    const nextReview = await withReconnect(() => rawRequest({ command, type: 'review.decision.write' }, webReviewSnapshotSchema));
    setReview(nextReview);
    const nextBootstrap = await withReconnect(() => rawRequest({ type: 'bootstrap.read' }, webBootstrapSnapshotSchema));
    setBootstrap(nextBootstrap);
  }, [rawRequest, withReconnect]);

  const readAgenda = useCallback((from: string, to: string) => withReconnect(() => rawRequest({ from, to, type: 'agenda.read' }, webAgendaPeriodSchema)), [rawRequest, withReconnect]);
  const readLibrary = useCallback((query: WebLibraryQuery) => withReconnect(() => rawRequest({ query, type: 'library.read' }, webLibraryPageSchema)), [rawRequest, withReconnect]);

  const value = useMemo<WebBridgeContextValue>(() => ({
    bootstrap,
    decideReview,
    readAgenda,
    readLibrary,
    refreshReview,
    retry: () => {
      automaticReconnectUsedRef.current = false;
      void establishConnection(false);
    },
    review,
    status,
  }), [bootstrap, decideReview, establishConnection, readAgenda, readLibrary, refreshReview, review, status]);

  return <WebBridgeContext.Provider value={value}>{children}</WebBridgeContext.Provider>;
}

export function useWebBridge() {
  const context = useContext(WebBridgeContext);
  if (!context) throw new Error('useWebBridge must be used inside WebBridgeProvider');
  return context;
}
