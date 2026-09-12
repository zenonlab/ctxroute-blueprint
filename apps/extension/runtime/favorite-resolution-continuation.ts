import type { FavoriteResolutionOutboxPort, StoragePort } from '@tobirink/application';
import { z } from 'zod';

export const favoriteResolutionContinuationAlarmName = 'tobirink-favorite-resolution-continuation-v1';
export const favoriteResolutionContinuationMinimumDelayMs = 30_000;
export const favoriteResolutionControlKey = 'tobirink.favorite-resolution-control.v1';
const favoriteResolutionControlSchema = z.strictObject({ paused: z.boolean(), version: z.literal(1) });
type FavoriteResolutionControl = z.infer<typeof favoriteResolutionControlSchema>;
type FavoriteResolutionControlValues = { [favoriteResolutionControlKey]?: FavoriteResolutionControl };

export interface FavoriteResolutionControlStorage {
  get(key: typeof favoriteResolutionControlKey): Promise<FavoriteResolutionControlValues>;
  set(value: { [favoriteResolutionControlKey]: FavoriteResolutionControl }): Promise<void>;
}

export async function readFavoriteResolutionPaused(storage: FavoriteResolutionControlStorage): Promise<boolean> {
  const value = (await storage.get(favoriteResolutionControlKey))[favoriteResolutionControlKey];
  const parsed = favoriteResolutionControlSchema.safeParse(value);
  return parsed.success && parsed.data.paused;
}

export async function writeFavoriteResolutionPaused(storage: FavoriteResolutionControlStorage, paused: boolean): Promise<void> {
  await storage.set({ [favoriteResolutionControlKey]: { paused, version: 1 } });
}

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
