import { describe, expect, it } from 'vitest';
import { createWebBridgeRuntime } from './web-bridge-runtime';

const origin = 'https://tobirink.example';
const sender = { url: `${origin}/library` };
const handshake = { handshake: { origin, protocolVersion: 3 as const, requestId: 'request_1', type: 'webbridge.handshake' as const }, type: 'webbridge.handshake' as const };

describe('web bridge runtime boundary', () => {
  it('accepts the exact origin and delegates a bounded request', async () => {
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: 3 }), { createNonce: () => 'issued_nonce', now: () => 1_000 });
    const response = await runtime(handshake, sender, origin);
    expect(response).toMatchObject({ expiresAt: 61_000, nonce: 'issued_nonce', ok: true, requestId: 'request_1' });
  });

  it('rejects a sender from another origin before delegation', async () => {
    const runtime = createWebBridgeRuntime(async () => { throw new Error('must not delegate'); });
    const response = await runtime(handshake, { url: 'https://evil.example/library' }, origin);
    expect(response).toMatchObject({ error: 'invalid-web-origin', ok: false, requestId: 'request_1' });
  });

  it('rejects unknown, expired and replayed sessions', async () => {
    let clock = 1_000;
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: 3 }), { createNonce: () => 'issued_nonce', now: () => clock });
    await runtime(handshake, sender, origin);
    const request = (nonce: string, requestId: string) => ({ envelope: { expiresAt: 61_000, nonce, origin, protocolVersion: 3 as const, request: { requestId, type: 'bootstrap.read' as const } }, type: 'webbridge.request' as const });
    expect(await runtime(request('unknown_nonce', 'request_2'), sender, origin)).toMatchObject({ error: 'unknown-web-session' });
    expect(await runtime(request('issued_nonce', 'request_2'), sender, origin)).toMatchObject({ ok: true, requestId: 'request_2' });
    expect(await runtime(request('issued_nonce', 'request_2'), sender, origin)).toMatchObject({ error: 'replayed-web-request' });
    clock = 61_000;
    expect(await runtime(request('issued_nonce', 'request_3'), sender, origin)).toMatchObject({ error: 'invalid-web-envelope' });
  });

  it('rejects UTF-8 messages and responses larger than 64 KiB', async () => {
    const runtime = createWebBridgeRuntime(async () => ({ error: 'é'.repeat(40_000) }), { createNonce: () => 'issued_nonce', now: () => 1_000 });
    await runtime(handshake, sender, origin);
    const oversized = { ...handshake, padding: 'é'.repeat(40_000) };
    expect(await runtime(oversized, sender, origin)).toMatchObject({ error: 'webbridge-message-too-large' });
    const request = { envelope: { expiresAt: 61_000, nonce: 'issued_nonce', origin, protocolVersion: 3 as const, request: { requestId: 'request_2', type: 'bootstrap.read' as const } }, type: 'webbridge.request' as const };
    expect(await runtime(request, sender, origin)).toMatchObject({ error: 'webbridge-message-too-large', requestId: 'request_2' });
  });
});
