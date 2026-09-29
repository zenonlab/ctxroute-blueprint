import { describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRateGate } from './provider-http';
import { favoriteProviderPolicy, FavoriteProviderRetryError } from './provider-kit';

describe('FavoriteProviderRateGate', () => {
  it.each([undefined, 900_000])('defers failed probes for ten minutes or longer Retry-After (%s)', async (retryAt) => {
    const controls = {
      recordFailure: vi.fn(async () => undefined), recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({ notBefore: 10_000, probeOnly: true })),
    };
    const probe = vi.fn(async () => { throw retryAt === undefined ? new Error('fetch failed') : new FavoriteProviderRetryError('limited', retryAt); });
    const operation = vi.fn();
    const gate = new FavoriteProviderRateGate('anilist', controls, () => 10_000, async () => undefined, probe);
    await expect(gate.run(3_000, operation)).rejects.toMatchObject({ retryAt: retryAt ?? 610_000 });
    expect(probe).toHaveBeenCalledOnce();
    expect(operation).not.toHaveBeenCalled();
    expect(controls.recordFailure).toHaveBeenCalledExactlyOnceWith('anilist', 10_000, retryAt ?? 610_000);
    expect(controls.recordSuccess).not.toHaveBeenCalled();
  });

  it('yields after a successful probe and executes the real operation only on the next reservation', async () => {
    const controls = {
      recordFailure: vi.fn(async () => undefined), recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn().mockResolvedValueOnce({ notBefore: 10_000, probeOnly: true }).mockResolvedValueOnce({ notBefore: 13_000, probeOnly: false }),
    };
    const probe = vi.fn(async () => undefined);
    const operation = vi.fn(async () => 'ok');
    const gate = new FavoriteProviderRateGate('anilist', controls, () => 10_000, async () => undefined, probe);
    await expect(gate.run(3_000, operation)).rejects.toMatchObject({ retryAt: 13_000 });
    expect(operation).not.toHaveBeenCalled();
    await expect(gate.run(3_000, operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledOnce();
    expect(controls.recordFailure).not.toHaveBeenCalled();
  });

  it('does not classify a D1 success-write failure as a provider failure', async () => {
    const controls = {
      recordFailure: vi.fn(async () => undefined), recordSuccess: vi.fn(async () => { throw new Error('D1 unavailable'); }),
      reserve: vi.fn(async () => ({ notBefore: 10_000, probeOnly: false })),
    };
    const gate = new FavoriteProviderRateGate('anilist', controls, () => 10_000);
    await expect(gate.run(3_000, async () => 'ok')).rejects.toThrow('D1 unavailable');
    expect(controls.recordFailure).not.toHaveBeenCalled();
  });

  it('keeps the conservative AniList and MangaUpdates HTTP budgets', () => {
    expect(favoriteProviderPolicy.anilist.minimumIntervalMs).toBe(3_000);
    expect(favoriteProviderPolicy.mangaupdates.minimumIntervalMs).toBe(6_000);
  });

  it('reserves persistent cadence and records success around one real request', async () => {
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({ notBefore: 10_000, probeOnly: false })),
    };
    const operation = vi.fn(async () => 'ok');
    const gate = new FavoriteProviderRateGate('anilist', controls, () => 10_000, async () => undefined);

    await expect(gate.run(3_000, operation)).resolves.toBe('ok');

    expect(controls.reserve).toHaveBeenCalledExactlyOnceWith('anilist', 10_000, 3_000);
    expect(operation).toHaveBeenCalledOnce();
    expect(controls.recordSuccess).toHaveBeenCalledExactlyOnceWith('anilist', 10_000);
    expect(controls.recordFailure).not.toHaveBeenCalled();
  });

  it('defers an open circuit without counting the deferred wake as a provider failure', async () => {
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({ notBefore: 20_000, probeOnly: false })),
    };
    const operation = vi.fn();
    const gate = new FavoriteProviderRateGate('mangaupdates', controls, () => 10_000, async () => undefined);

    await expect(gate.run(6_000, operation)).rejects.toMatchObject({ retryAt: 20_000 });

    expect(operation).not.toHaveBeenCalled();
    expect(controls.recordFailure).not.toHaveBeenCalled();
  });

  it('persists Retry-After when a started provider request fails', async () => {
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({ notBefore: 10_000, probeOnly: false })),
    };
    const gate = new FavoriteProviderRateGate('anilist', controls, () => 10_000, async () => undefined);

    await expect(gate.run(3_000, async () => { throw new FavoriteProviderRetryError('limited', 70_000); }))
      .rejects.toMatchObject({ retryAt: 70_000 });

    expect(controls.recordFailure).toHaveBeenCalledExactlyOnceWith('anilist', 10_000, 70_000);
    expect(controls.recordSuccess).not.toHaveBeenCalled();
  });
});
