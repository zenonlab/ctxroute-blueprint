import type { FavoriteResolutionOutboxPort, StoragePort } from '@tobirink/application';
import { z } from 'zod';

export const favoriteResolutionContinuationAlarmName = 'tobirink-favorite-resolution-continuation-v1';
export const favoriteResolutionContinuationMinimumDelayMs = 30_000;
export const favoriteProviderRecoveryAlarmName = 'tobirink-provider-recovery-continuation-v1';
export const favoriteProviderRecoveryMinimumDelayMs = 30_000;
export const favoriteProviderRecoveryMaximumDurationMs = 15_000;
export const favoriteProviderRecoveryMaximumAdmissions = 10;
export const favoriteProviderRecoveryCursorKey = 'tobirink.favorite-provider-recovery.v1';
export const favoriteResolutionControlKey = 'tobirink.favorite-resolution-control.v1';
const favoriteResolutionControlSchema = z.strictObject({ paused: z.boolean(), version: z.literal(1) });
type FavoriteResolutionControl = z.infer<typeof favoriteResolutionControlSchema>;
type FavoriteResolutionControlValues = { [favoriteResolutionControlKey]?: FavoriteResolutionControl };
const favoriteProviderRecoveryCursorSchema = z.strictObject({ afterId: z.string().min(1).optional(), retryAt: z.iso.datetime({ offset: false }).optional(), version: z.literal(1) });
export type FavoriteProviderRecoveryCursor = z.infer<typeof favoriteProviderRecoveryCursorSchema>;
type FavoriteProviderRecoveryCursorValues = { [favoriteProviderRecoveryCursorKey]?: FavoriteProviderRecoveryCursor };

export interface FavoriteResolutionControlStorage {
  get(key: typeof favoriteResolutionControlKey): Promise<FavoriteResolutionControlValues>;
  set(value: { [favoriteResolutionControlKey]: FavoriteResolutionControl }): Promise<void>;
}

export interface FavoriteProviderRecoveryCursorStorage {
  get(key: typeof favoriteProviderRecoveryCursorKey): Promise<FavoriteProviderRecoveryCursorValues>;
  set(value: { [favoriteProviderRecoveryCursorKey]: FavoriteProviderRecoveryCursor } | { [favoriteProviderRecoveryCursorKey]: undefined }): Promise<void>;
}

export async function readFavoriteProviderRecoveryCursor(storage: FavoriteProviderRecoveryCursorStorage): Promise<FavoriteProviderRecoveryCursor | undefined> {
  const value = (await storage.get(favoriteProviderRecoveryCursorKey))[favoriteProviderRecoveryCursorKey];
  const parsed = favoriteProviderRecoveryCursorSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function writeFavoriteProviderRecoveryCursor(storage: FavoriteProviderRecoveryCursorStorage, cursor: Omit<FavoriteProviderRecoveryCursor, 'version'> | undefined): Promise<void> {
  if (cursor === undefined) {
    await storage.set({ [favoriteProviderRecoveryCursorKey]: undefined });
    return;
  }
  await storage.set({ [favoriteProviderRecoveryCursorKey]: { ...cursor, version: 1 } });
}

export async function restoreFavoriteProviderRecoveryContinuation(alarms: FavoriteResolutionAlarmPort, storage: FavoriteProviderRecoveryCursorStorage, now = Date.now): Promise<void> {
  const cursor = await readFavoriteProviderRecoveryCursor(storage);
  if (cursor === undefined) {
    await alarms.clear(favoriteProviderRecoveryAlarmName);
    return;
  }
  const retryAt = cursor.retryAt === undefined ? 0 : Date.parse(cursor.retryAt);
  await alarms.create(favoriteProviderRecoveryAlarmName, { when: Math.max(now() + favoriteProviderRecoveryMinimumDelayMs, Number.isFinite(retryAt) ? retryAt : 0) });
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
