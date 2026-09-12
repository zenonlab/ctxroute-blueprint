import type { FavoriteResolutionOutboxPort, StoragePort } from '@tobirink/application';

export const favoriteResolutionContinuationAlarmName = 'tobirink-favorite-resolution-continuation-v1';
export const favoriteResolutionContinuationMinimumDelayMs = 30_000;

export interface FavoriteResolutionAlarmPort {
  clear(name: string): Promise<boolean> | boolean;
  create(name: string, alarmInfo: { when: number }): Promise<void> | void;
}

export async function updateFavoriteResolutionContinuation(alarms: FavoriteResolutionAlarmPort, availableAt: string | undefined, now = Date.now): Promise<void> {
  if (availableAt === undefined) {
    await alarms.clear(favoriteResolutionContinuationAlarmName);
    return;
  }
  const dueAt = new Date(availableAt);
  if (Number.isNaN(dueAt.valueOf()) || dueAt.toISOString() !== availableAt) throw new TypeError('Favorite continuation deadline must be canonical.');
  await alarms.create(favoriteResolutionContinuationAlarmName, { when: Math.max(now() + favoriteResolutionContinuationMinimumDelayMs, dueAt.valueOf()) });
}

export async function restoreFavoriteResolutionContinuation(
  alarms: FavoriteResolutionAlarmPort,
  storage: Pick<StoragePort, 'getFavoriteInventoryCheckpoint'>,
  outbox: Pick<FavoriteResolutionOutboxPort, 'nextAvailableAt'>,
  now = Date.now,
): Promise<string | undefined> {
  const checkpoint = await storage.getFavoriteInventoryCheckpoint();
  const availableAt = checkpoint?.status === 'active'
    ? new Date(now()).toISOString()
    : await outbox.nextAvailableAt({ kind: 'favorite-resolution', lane: 'routing' });
  await updateFavoriteResolutionContinuation(alarms, availableAt, now);
  return availableAt;
}
