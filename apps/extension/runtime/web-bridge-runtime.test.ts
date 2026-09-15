import { describe, expect, it } from 'vitest';
import { webProtocolVersion } from '@tobirink/contracts/web-bridge';
import { createWebBridgeRuntime } from './web-bridge-runtime';

const origin = 'https://tobirink.example';
const sender = { url: `${origin}/library` };
const handshake = { handshake: { origin, protocolVersion: webProtocolVersion, requestId: 'request_1', type: 'webbridge.handshake' as const }, type: 'webbridge.handshake' as const };
const handshakeFor = (requestId: string) => ({ handshake: { origin, protocolVersion: webProtocolVersion, requestId, type: 'webbridge.handshake' as const }, type: 'webbridge.handshake' as const });
const requestFor = (nonce: string, requestId: string) => ({ envelope: { expiresAt: 61_000, nonce, origin, protocolVersion: webProtocolVersion, request: { requestId, type: 'bootstrap.read' as const } }, type: 'webbridge.request' as const });

describe('web bridge runtime boundary', () => {
  it('accepts the exact origin and delegates a bounded request', async () => {
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: webProtocolVersion }), { createNonce: () => 'issued_nonce', now: () => 1_000 });
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
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: webProtocolVersion }), { createNonce: () => 'issued_nonce', now: () => clock });
    await runtime(handshake, sender, origin);
    const request = (nonce: string, requestId: string) => ({ envelope: { expiresAt: 61_000, nonce, origin, protocolVersion: webProtocolVersion, request: { requestId, type: 'bootstrap.read' as const } }, type: 'webbridge.request' as const });
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
    const request = { envelope: { expiresAt: 61_000, nonce: 'issued_nonce', origin, protocolVersion: webProtocolVersion, request: { requestId: 'request_2', type: 'bootstrap.read' as const } }, type: 'webbridge.request' as const };
    expect(await runtime(request, sender, origin)).toMatchObject({ error: 'webbridge-message-too-large', requestId: 'request_2' });
  });

  it('expires a session after 64 correlated request ids', async () => {
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: webProtocolVersion }), { createNonce: () => 'quota_nonce', now: () => 1_000 });
    await runtime(handshakeFor('handshake_quota'), sender, origin);
    for (let index = 0; index < 63; index += 1) expect(await runtime(requestFor('quota_nonce', `quota_${index}`), sender, origin)).toMatchObject({ ok: true });
    expect(await runtime(requestFor('quota_nonce', 'quota_exhausted'), sender, origin)).toMatchObject({ error: 'webbridge-session-quota' });
    expect(await runtime(requestFor('quota_nonce', 'quota_after_expiry'), sender, origin)).toMatchObject({ error: 'unknown-web-session' });
  });

  it('keeps at most 32 sessions and evicts the least recently used session', async () => {
    let nonceIndex = 0;
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: webProtocolVersion }), { createNonce: () => `nonce_${nonceIndex++}`, now: () => 1_000 });
    for (let index = 0; index < 32; index += 1) await runtime(handshakeFor(`handshake_${index}`), sender, origin);
    expect(await runtime(requestFor('nonce_0', 'touch_first'), sender, origin)).toMatchObject({ ok: true });
    await runtime(handshakeFor('handshake_32'), sender, origin);
    expect(await runtime(requestFor('nonce_1', 'evicted_request'), sender, origin)).toMatchObject({ error: 'unknown-web-session' });
    expect(await runtime(requestFor('nonce_0', 'retained_request'), sender, origin)).toMatchObject({ ok: true });
  });

  it('bounds request ids globally and evicts an old session before accepting more', async () => {
    let nonceIndex = 0;
    const runtime = createWebBridgeRuntime(async () => ({ availability: 'connected', generation: 0, libraryCount: 0, pendingReviewCount: 0, protocolVersion: webProtocolVersion }), { createNonce: () => `global_${nonceIndex++}`, now: () => 1_000 });
    for (let session = 0; session < 32; session += 1) await runtime(handshakeFor(`global_handshake_${session}`), sender, origin);
    for (let session = 0; session < 32; session += 1) {
      for (let request = 0; request < 15; request += 1) await runtime(requestFor(`global_${session}`, `global_request_${session}_${request}`), sender, origin);
    }
    expect(await runtime(requestFor('global_31', 'global_overflow'), sender, origin)).toMatchObject({ ok: true });
    expect(await runtime(requestFor('global_0', 'global_evicted'), sender, origin)).toMatchObject({ error: 'unknown-web-session' });
  });
});
