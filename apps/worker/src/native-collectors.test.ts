import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgendaCollectionRetryError, agendaCollectionFailureCode, handleNativeCollectorQueue, type NativeCollectorSignal } from './native-collectors';

function message(body: NativeCollectorSignal | null, attempts = 1) {
  return { ack: vi.fn(), attempts, body, retry: vi.fn() };
}

describe('native collector queue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('acknowledges a malformed signal without invoking a processor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message(null);
    const agenda = vi.fn(); const discovery = vi.fn();
    await handleNativeCollectorQueue([item], { agenda, discovery });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled(); expect(agenda).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'collector-signal-invalid', disposition: 'ack-invalid', messageType: 'invalid' });
  });

  it('acknowledges a successful discovery signal', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const item = message({ type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({ claimed: 1, failed: 0, published: 1, replayed: 0 }) });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ disposition: 'ack-success', messageType: 'public-discovery-ready' });
  });

  it('retries a failed leased discovery after lease expiry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({ claimed: 1, failed: 1, published: 0, replayed: 0 }) });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 900 }); expect(item.ack).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'public-discovery-partial', disposition: 'retry', retryDelaySeconds: 900 });
  });

  it('runs Agenda and applies bounded exponential retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 3);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new Error('upstream'); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 240 }); expect(item.ack).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'collector-internal', disposition: 'retry', messageType: 'agenda-refresh' });
  });

  it('uses an Agenda provider Retry-After delay instead of generic backoff', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 3);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new AgendaCollectionRetryError('agenda-mangaupdates-unavailable', 1_200); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 1_200 });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'agenda-mangaupdates-unavailable', retryDelaySeconds: 1_200 });
  });

  it('marks the configured final attempt as destined for the DLQ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 9);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new Error('agenda-anilist-unavailable'); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 3_600 });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ attempt: 9, code: 'agenda-anilist-unavailable', disposition: 'retry-to-dlq' });
  });

  it('reduces lane failures to bounded provider-specific codes', () => {
    expect(agendaCollectionFailureCode(['anilist:HTTP 403'])).toBe('agenda-anilist-unavailable');
    expect(agendaCollectionFailureCode(['mangaupdates:timeout'])).toBe('agenda-mangaupdates-unavailable');
    expect(agendaCollectionFailureCode(['anilist:HTTP 403', 'mangaupdates:timeout'])).toBe('agenda-anilist-mangaupdates-unavailable');
    expect(agendaCollectionFailureCode(['unknown:raw upstream payload'])).toBe('agenda-provider-unavailable');
  });
});
