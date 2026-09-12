import { describe, expect, it } from 'vitest';
import { parseWebMessage, parseWebRequestEnvelope, webBridgeMessageLimit, webPageBridgeInboundSchema, webProtocolVersion, webRequestSchema } from './web-bridge';

describe('WebBridgePort transport contract', () => {
  it('accepts only bounded versioned requests', () => {
    expect(webRequestSchema.parse({ type: 'bootstrap.read', requestId: 'req_1' })).toEqual({ type: 'bootstrap.read', requestId: 'req_1' });
    expect(webBridgeMessageLimit).toBe(65536);
  });

  it('rejects generic browser messages and unknown fields', () => {
    expect(() => parseWebMessage({ type: 'tabs.query', requestId: 'req_1' })).toThrow();
    expect(() => parseWebMessage({ type: 'bootstrap.read', requestId: 'req_1', extra: true })).toThrow();
  });

  it('allows the one Review write and no other write command', () => {
    expect(parseWebMessage({ type: 'review.decision.write', requestId: 'req_2', command: { decision: { kind: 'none' }, reviewId: 'review_source1', revision: 'review-v1-current' } })).toMatchObject({ type: 'review.decision.write' });
    expect(() => parseWebMessage({ type: 'library.write', requestId: 'req_3' })).toThrow();
  });

  it('requires the exact origin and an unexpired nonce envelope', () => {
    const envelope = { expiresAt: 2_000, nonce: 'nonce_1', origin: 'https://tobirink.example', protocolVersion: webProtocolVersion, request: { type: 'bootstrap.read' as const, requestId: 'req_4' } };
    expect(parseWebRequestEnvelope(envelope, 'https://tobirink.example', 1_000).request.type).toBe('bootstrap.read');
    expect(() => parseWebRequestEnvelope(envelope, 'https://evil.example', 1_000)).toThrow('webbridge-origin-mismatch');
    expect(() => parseWebRequestEnvelope(envelope, 'https://tobirink.example', 2_000)).toThrow('webbridge-nonce-expired');
  });

  it('measures the serialized UTF-8 envelope, not JavaScript code units', () => {
    expect(() => parseWebMessage({ type: 'bootstrap.read', requestId: 'é'.repeat(40_000) })).toThrow('webbridge-message-too-large');
  });

  it('bounds library pages to 24 and agenda reads to one Monday-to-Monday week', () => {
    expect(webRequestSchema.parse({ type: 'library.read', requestId: 'req_5', query: { facet: 'anime', limit: 24, search: 'étoile' } })).toBeTruthy();
    expect(() => webRequestSchema.parse({ type: 'library.read', requestId: 'req_6', query: { limit: 25 } })).toThrow();
    expect(webRequestSchema.parse({ type: 'agenda.read', requestId: 'req_7', from: '2026-09-07', to: '2026-09-14' })).toBeTruthy();
    expect(() => webRequestSchema.parse({ type: 'agenda.read', requestId: 'req_8', from: '2026-09-08', to: '2026-09-15' })).toThrow(/Monday-to-Monday/u);
    expect(() => webRequestSchema.parse({ type: 'agenda.read', requestId: 'req_9', from: '2026-09-07', to: '2026-09-15' })).toThrow(/Monday-to-Monday/u);
  });

  it('validates correlated page responses while preserving version mismatch detection', () => {
    const handshake = {
      requestId: 'req_10',
      response: { expiresAt: 60_000, nonce: 'nonce_10', ok: true, protocolVersion: webProtocolVersion, requestId: 'req_10', type: 'tobirink.webbridge.response' },
      type: 'tobirink.webbridge.response',
    };
    expect(webPageBridgeInboundSchema.parse(handshake)).toEqual(handshake);
    expect(webPageBridgeInboundSchema.parse({ ...handshake, response: { ...handshake.response, protocolVersion: 1 } }).response.protocolVersion).toBe(1);
    expect(() => webPageBridgeInboundSchema.parse({ ...handshake, extra: true })).toThrow();
  });
});
