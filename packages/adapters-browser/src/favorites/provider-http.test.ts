import { describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRateGate } from './provider-http';

describe('FavoriteProviderRateGate', () => {
  it('persists the next reservation before the provider effect', async () => {
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
});
