import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderJson } from './provider-http';

describe('FavoriteProviderRateGate', () => {
  it('Q-06 persists the exact next reservation before the provider effect', async () => {
    let stored = 12_000;
    let current = 10_000;
    const wait = vi.fn(async (milliseconds: number) => { current += milliseconds; });
    const checkpoints = {
      read: vi.fn(async () => stored),
      write: vi.fn(async (_provider: 'anilist' | 'mangaupdates', value: number) => { stored = value; }),
    };
    const operation = vi.fn(async () => 'ok');
    const gate = new FavoriteProviderRateGate('anilist', checkpoints, () => current, wait);

    await expect(gate.run(2_200, operation)).resolves.toBe('ok');
    expect(wait).toHaveBeenCalledWith(2_000);
    expect(checkpoints.write).toHaveBeenCalledWith('anilist', 14_200);
    expect(checkpoints.write.mock.invocationCallOrder[0]).toBeLessThan(operation.mock.invocationCallOrder[0] ?? 0);
  });

  it('releases its queue after checkpoint storage fails', async () => {
    const checkpoints = { read: vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(0), write: vi.fn(async () => {}) };
    const gate = new FavoriteProviderRateGate('anilist', checkpoints);
    const operation = vi.fn(async () => 'ok');
    await expect(gate.run(2200, operation)).rejects.toThrow('storage unavailable');
    await expect(gate.run(2200, operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('persists Retry-After and defers a later wake without another network call', async () => {
    let stored = 0;
    const checkpoints = { read: async () => stored, write: async (_provider: 'anilist', value: number) => { stored = value; } };
    const wait = vi.fn(async () => {});
    const gate = new FavoriteProviderRateGate('anilist', checkpoints, Date.now, wait);
    const fetcher = vi.fn(async () => new Response(null, { headers: { 'Retry-After': '7200' }, status: 429 }));
    const operation = () => readFavoriteProviderJson(fetcher, 'https://fixtures.tobirink.invalid/provider', {}, z.strictObject({}));
    const started = Date.now();
    await expect(gate.run(2200, operation)).rejects.toThrow('429');
    expect(stored).toBeGreaterThanOrEqual(started + 7_200_000);
    const resumed = new FavoriteProviderRateGate('anilist', checkpoints, Date.now, wait);
    await expect(resumed.run(2200, operation)).rejects.toMatchObject({ retryAt: stored });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
