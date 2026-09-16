import { describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRateGate } from './provider-http';
import { favoriteProviderPolicy, FavoriteProviderRetryError } from './provider-kit';

describe('FavoriteProviderRateGate', () => {
  it('keeps the conservative AniList and MangaUpdates HTTP budgets', () => {
    expect(favoriteProviderPolicy.anilist.minimumIntervalMs).toBe(3_000);
    expect(favoriteProviderPolicy.mangaupdates.minimumIntervalMs).toBe(6_000);
  });

  it('reserves persistent cadence and records success around one real request', async () => {
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async () => 10_000),
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
      reserve: vi.fn(async () => 20_000),
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
      reserve: vi.fn(async () => 10_000),
    };
    const gate = new FavoriteProviderRateGate('anilist', controls, () => 10_000, async () => undefined);

    await expect(gate.run(3_000, async () => { throw new FavoriteProviderRetryError('limited', 70_000); }))
      .rejects.toMatchObject({ retryAt: 70_000 });

    expect(controls.recordFailure).toHaveBeenCalledExactlyOnceWith('anilist', 10_000, 70_000);
    expect(controls.recordSuccess).not.toHaveBeenCalled();
  });
});
