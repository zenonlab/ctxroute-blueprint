import { describe, expect, it, vi } from 'vitest';
import { handleNativeCollectorQueue, type NativeCollectorSignal } from './native-collectors';

function message(body: NativeCollectorSignal | null, attempts = 1) {
  return { ack: vi.fn(), attempts, body, retry: vi.fn() };
}

describe('native collector queue', () => {
  it('acknowledges a malformed signal without invoking a processor', async () => {
    const item = message(null);
    const agenda = vi.fn(); const discovery = vi.fn();
    await handleNativeCollectorQueue([item], { agenda, discovery });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled(); expect(agenda).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled();
  });

  it('acknowledges a successful discovery signal', async () => {
    const item = message({ type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({ claimed: 1, failed: 0, published: 1, replayed: 0 }) });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
  });

  it('retries a failed leased discovery after lease expiry', async () => {
    const item = message({ type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({ claimed: 1, failed: 1, published: 0, replayed: 0 }) });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 900 }); expect(item.ack).not.toHaveBeenCalled();
  });

  it('runs Agenda and applies bounded exponential retry', async () => {
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 3);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new Error('upstream'); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 240 }); expect(item.ack).not.toHaveBeenCalled();
  });
});
