import { MemoryStoragePort } from '@tobirink/contracts';
import { describe, expect, it, vi } from 'vitest';
import { favoriteProviderRecoveryAlarmName, favoriteProviderRecoveryCursorKey, favoriteProviderRecoveryMaximumAdmissions, favoriteProviderRecoveryMaximumDurationMs, favoriteProviderRecoveryMinimumDelayMs, favoriteResolutionContinuationAlarmName, favoriteResolutionContinuationMinimumDelayMs, favoriteResolutionControlKey, readFavoriteProviderRecoveryCursor, readFavoriteResolutionPaused, restoreFavoriteProviderRecoveryContinuation, restoreFavoriteResolutionContinuation, updateFavoriteResolutionContinuation, writeFavoriteProviderRecoveryCursor, writeFavoriteResolutionPaused } from './favorite-resolution-continuation';

describe('favorite resolution continuation', () => {
  it('tracks the exact durable deadline with the supported 30-second floor and clears an empty queue', async () => {
    const create = vi.fn(async () => undefined);
    const clear = vi.fn(async () => true);
    const now = Date.parse('2026-09-12T12:00:00.000Z');
    await updateFavoriteResolutionContinuation({ clear, create }, '2026-09-12T12:00:00.000Z', () => now);
    expect(create).toHaveBeenCalledWith(favoriteResolutionContinuationAlarmName, { when: now + favoriteResolutionContinuationMinimumDelayMs });
    await updateFavoriteResolutionContinuation({ clear, create }, '2026-09-12T12:05:00.000Z', () => now);
    expect(create).toHaveBeenLastCalledWith(favoriteResolutionContinuationAlarmName, { when: Date.parse('2026-09-12T12:05:00.000Z') });
    await updateFavoriteResolutionContinuation({ clear, create }, undefined, () => now);
    expect(clear).toHaveBeenCalledWith(favoriteResolutionContinuationAlarmName);
    expect(favoriteResolutionContinuationMinimumDelayMs).toBe(30_000);
  });

  it('restores an interrupted inventory before consulting the provider deadline', async () => {
    const storage = new MemoryStoragePort();
    await storage.putFavoriteInventoryCheckpoint({ id: 'favorite-inventory', phase: 'presence', sessionId: 'resume-session', startedAt: '2026-09-12T12:00:00.000Z', status: 'active' });
    const create = vi.fn(async () => undefined);
    const nextAvailableAt = vi.fn(async () => '2026-09-12T13:00:00.000Z');
    const now = Date.parse('2026-09-12T12:05:00.000Z');

    await expect(restoreFavoriteResolutionContinuation({ clear: vi.fn(), create }, storage, { nextAvailableAt }, () => now)).resolves.toBe('2026-09-12T12:05:00.000Z');
    expect(nextAvailableAt).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(favoriteResolutionContinuationAlarmName, { when: now + favoriteResolutionContinuationMinimumDelayMs });

    await storage.putFavoriteInventoryCheckpoint({ id: 'favorite-inventory', sessionId: 'resume-session', startedAt: '2026-09-12T12:00:00.000Z', status: 'complete' });
    await expect(restoreFavoriteResolutionContinuation({ clear: vi.fn(), create }, storage, { nextAvailableAt }, () => now)).resolves.toBe('2026-09-12T13:00:00.000Z');
    expect(nextAvailableAt).toHaveBeenCalledOnce();
  });

  it('persists pause as a strict extension-local controller value', async () => {
    let value: { paused: boolean; version: 1 } | undefined;
    const storage = {
      get: async () => ({ [favoriteResolutionControlKey]: value }),
      set: async (next: { [favoriteResolutionControlKey]: { paused: boolean; version: 1 } }) => { value = next[favoriteResolutionControlKey]; },
    };
    await expect(readFavoriteResolutionPaused(storage)).resolves.toBe(false);
    await writeFavoriteResolutionPaused(storage, true);
    await expect(readFavoriteResolutionPaused(storage)).resolves.toBe(true);
    await writeFavoriteResolutionPaused(storage, false);
    await expect(readFavoriteResolutionPaused(storage)).resolves.toBe(false);
  });

  it('persists and clears the provider recovery cursor', async () => {
    let value: { afterId?: string; retryAt?: string; version: 1 } | undefined;
    const storage = {
      get: async () => ({ [favoriteProviderRecoveryCursorKey]: value }),
      set: async (next: { [favoriteProviderRecoveryCursorKey]: typeof value }) => { value = next[favoriteProviderRecoveryCursorKey]; },
    };
    await expect(readFavoriteProviderRecoveryCursor(storage)).resolves.toBeUndefined();
    await writeFavoriteProviderRecoveryCursor(storage, { afterId: 'source-20', retryAt: '2026-09-12T12:05:00.000Z' });
    await expect(readFavoriteProviderRecoveryCursor(storage)).resolves.toEqual({ afterId: 'source-20', retryAt: '2026-09-12T12:05:00.000Z', version: 1 });
    await writeFavoriteProviderRecoveryCursor(storage, undefined);
    await expect(readFavoriteProviderRecoveryCursor(storage)).resolves.toBeUndefined();
    expect(favoriteProviderRecoveryMinimumDelayMs).toBe(30_000);
    expect(favoriteProviderRecoveryMaximumDurationMs).toBe(15_000);
    expect(favoriteProviderRecoveryMaximumAdmissions).toBe(10);
  });

  it('restores the persisted provider-recovery alarm after service-worker startup', async () => {
    const now = Date.parse('2026-09-12T12:00:00.000Z');
    const create = vi.fn(async () => undefined);
    const storage = { get: async () => ({ [favoriteProviderRecoveryCursorKey]: { afterId: 'source-20', retryAt: '2026-09-12T12:05:00.000Z', version: 1 as const } }), set: vi.fn() };
    await restoreFavoriteProviderRecoveryContinuation({ clear: vi.fn(), create }, storage, () => now);
    expect(create).toHaveBeenCalledWith(favoriteProviderRecoveryAlarmName, { when: Date.parse('2026-09-12T12:05:00.000Z') });
  });
});
