import { favoriteResolutionTaskIdentity, preparePublicFavoriteDiscoveryIdentity, PublicDiscoveryError, requestPublicFavoriteDiscoveryRecovery } from '@tobirink/application';
import type { FavoriteIdentityLookupPort, FavoriteResolutionOutboxPort, PublicDiscoveryRequestClientPort, StoragePort } from '@tobirink/application';
import { createFavoriteSource, favoriteSourceId } from '@tobirink/domain';
import type { FavoriteResolutionResult, FavoriteSourceId } from '@tobirink/domain';
import { z } from 'zod';

export const favoriteResolutionContinuationAlarmName = 'tobirink-favorite-resolution-continuation-v1';
export const favoriteResolutionContinuationMinimumDelayMs = 30_000;
export const favoriteProviderRecoveryAlarmName = 'tobirink-provider-recovery-continuation-v1';
export const favoriteProviderRecoveryMinimumDelayMs = 30_000;
export const favoriteProviderRecoveryMaximumDurationMs = 15_000;
const favoriteProviderRecoveryAdmissionDurationMs = 45_000;
export const favoriteProviderRecoveryMaximumAdmissions = 10;
export const favoriteProviderRecoveryCursorKey = 'tobirink.favorite-provider-recovery.v1';
export const favoriteResolutionControlKey = 'tobirink.favorite-resolution-control.v1';
const favoriteResolutionControlSchema = z.strictObject({ paused: z.boolean(), version: z.literal(1) });
type FavoriteResolutionControl = z.infer<typeof favoriteResolutionControlSchema>;
type FavoriteResolutionControlValues = { [favoriteResolutionControlKey]?: FavoriteResolutionControl };
const favoriteProviderRecoveryCursorSchema = z.strictObject({ afterId: z.string().min(1).optional(), pendingSourceId: z.string().min(1).optional(), retryAt: z.iso.datetime({ offset: false }).optional(), version: z.literal(1) });
export type FavoriteProviderRecoveryCursor = z.infer<typeof favoriteProviderRecoveryCursorSchema>;
type FavoriteProviderRecoveryCursorValues = { [favoriteProviderRecoveryCursorKey]?: FavoriteProviderRecoveryCursor };

export interface FavoriteResolutionControlStorage {
  get(key: typeof favoriteResolutionControlKey): Promise<FavoriteResolutionControlValues>;
  set(value: { [favoriteResolutionControlKey]: FavoriteResolutionControl }): Promise<void>;
}

export interface FavoriteProviderRecoveryCursorStorage {
  get(key: typeof favoriteProviderRecoveryCursorKey): Promise<FavoriteProviderRecoveryCursorValues>;
  set(value: { [favoriteProviderRecoveryCursorKey]: FavoriteProviderRecoveryCursor }): Promise<void>;
  remove(key: typeof favoriteProviderRecoveryCursorKey): Promise<void>;
}

export async function readFavoriteProviderRecoveryCursor(storage: FavoriteProviderRecoveryCursorStorage): Promise<FavoriteProviderRecoveryCursor | undefined> {
  const value = (await storage.get(favoriteProviderRecoveryCursorKey))[favoriteProviderRecoveryCursorKey];
  const parsed = favoriteProviderRecoveryCursorSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function writeFavoriteProviderRecoveryCursor(storage: FavoriteProviderRecoveryCursorStorage, cursor: Omit<FavoriteProviderRecoveryCursor, 'version'> | undefined): Promise<void> {
  if (cursor === undefined) {
    await storage.remove(favoriteProviderRecoveryCursorKey);
    return;
  }
  await storage.set({ [favoriteProviderRecoveryCursorKey]: { ...cursor, version: 1 } });
}

export async function restoreFavoriteProviderRecoveryContinuation(alarms: FavoriteResolutionAlarmPort, storage: FavoriteProviderRecoveryCursorStorage, now = Date.now, paused = false): Promise<void> {
  const cursor = await readFavoriteProviderRecoveryCursor(storage);
  if (cursor === undefined || paused) {
    await alarms.clear(favoriteProviderRecoveryAlarmName);
    return;
  }
  const retryAt = cursor.retryAt === undefined ? 0 : Date.parse(cursor.retryAt);
  const dueAt = Number.isFinite(retryAt) ? retryAt : 0;
  const when = Math.max(now() + favoriteProviderRecoveryMinimumDelayMs, dueAt);
  const existing = await alarms.get?.(favoriteProviderRecoveryAlarmName);
  if (existing?.scheduledTime !== undefined && existing.scheduledTime > now() && existing.scheduledTime >= dueAt && existing.scheduledTime <= when) return;
  await alarms.create(favoriteProviderRecoveryAlarmName, { when });
}

/** A finite, explicitly started pass, continued by alarms without rearming its completed entries. */
export function createFavoriteProviderRecovery(dependencies: {
  alarms: FavoriteResolutionAlarmPort;
  checkpointStorage: FavoriteProviderRecoveryCursorStorage;
  client: PublicDiscoveryRequestClientPort;
  storage: StoragePort;
  synchronized?: FavoriteIdentityLookupPort;
  paused: () => Promise<boolean>;
  now?: () => number;
}) {
  const now = dependencies.now ?? Date.now;
  let inFlight: Promise<number> | undefined;
  const restore = async () => restoreFavoriteProviderRecoveryContinuation(dependencies.alarms, dependencies.checkpointStorage, now, await dependencies.paused());
  const recordReason = async (id: FavoriteSourceId, reason: Extract<FavoriteResolutionResult, { kind: 'RETRYABLE' }>['reason'], availableAt?: string) => {
    await dependencies.storage.transaction(['favoriteSources', 'favoriteResolutionTasks'], async (session) => {
      const source = await session.getFavoriteSource(id);
      if (source?.resolution?.kind === 'RETRYABLE' && source.resolution.reason === 'PROVIDER_UNAVAILABLE') {
        await session.putFavoriteSource(createFavoriteSource({ ...source, resolution: { kind: 'RETRYABLE', reason } }));
        const task = availableAt === undefined ? undefined : await session.getFavoriteResolutionTask(favoriteResolutionTaskIdentity(source.bookmarkId));
        if (task?.state === 'RETRY_AT' && availableAt !== undefined) await session.putFavoriteResolutionTask({ ...task, availableAt, retryAt: availableAt });
      }
    });
  };
  const run = async (start: boolean) => {
    if (await dependencies.paused()) { await restore(); return 0; }
    let cursor = await readFavoriteProviderRecoveryCursor(dependencies.checkpointStorage);
    if (cursor === undefined) {
      if (!start) return 0;
      cursor = { version: 1 };
      await writeFavoriteProviderRecoveryCursor(dependencies.checkpointStorage, cursor);
    }
    await restore(); // Schedule before any I/O: a killed service worker leaves a durable wake.
    if (cursor.retryAt !== undefined && Date.parse(cursor.retryAt) > now()) return 0;
    let afterId = cursor.afterId === undefined ? undefined : favoriteSourceId(cursor.afterId);
    let attempted = 0;
    let recovered = 0;
    const deadline = now() + favoriteProviderRecoveryMaximumDurationMs;
    const checkpoint = async (next: Omit<FavoriteProviderRecoveryCursor, 'version'>) => {
      cursor = { ...next, version: 1 };
      await writeFavoriteProviderRecoveryCursor(dependencies.checkpointStorage, cursor);
    };
    dependencies.client.setDeadline?.(deadline);
    try {
      for (;;) {
        const page = await dependencies.storage.listFavoriteSources({ afterId, limit: 100 });
        for (const source of page) {
          if (await dependencies.paused() || now() >= deadline || attempted >= favoriteProviderRecoveryMaximumAdmissions) { await restore(); return recovered; }
          if (source.presence === 'observed' && source.resolution?.kind === 'RETRYABLE' && source.resolution.reason === 'PROVIDER_UNAVAILABLE') {
            attempted += 1;
            try {
              const artifact = (await dependencies.storage.getFavoriteParseArtifact(source.id))?.artifact;
              if (artifact === undefined) throw new Error('MISSING_RECOVERY_ARTIFACT');
              const { key, reference } = await preparePublicFavoriteDiscoveryIdentity(artifact, dependencies.synchronized);
              dependencies.client.setDeadline?.(deadline);
              // If suspended after sending, read its result instead of blindly rearming FAILED again.
              const previous = cursor.pendingSourceId === source.id
                ? (await dependencies.client.lookup?.([key]))?.[0]?.state : undefined;
              await checkpoint({ afterId, pendingSourceId: source.id, retryAt: new Date(now() + 60_000).toISOString() });
              dependencies.client.setDeadline?.(now() + favoriteProviderRecoveryAdmissionDurationMs);
              const state = previous !== undefined && previous.state !== 'MISS' ? previous
                : await requestPublicFavoriteDiscoveryRecovery(dependencies.client, key, artifact, reference === undefined ? undefined : { explicitProviderReference: reference });
              if (state.state === 'MISS') throw new PublicDiscoveryError('INVALID_RESPONSE');
              if (state.state !== 'UNAVAILABLE') await recordReason(source.id, 'PUBLIC_DISCOVERY_PENDING', state.state === 'PENDING' ? state.retryAt : new Date(now()).toISOString());
              if (state.state !== 'UNAVAILABLE') recovered += 1;
            } catch (error) {
              if (error instanceof PublicDiscoveryError && ['ADMISSION_WAIT', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT', 'SERVICE_UNAVAILABLE'].includes(error.code)) {
                const pendingSourceId = ['NETWORK', 'TIMEOUT', 'SERVICE_UNAVAILABLE'].includes(error.code) ? cursor.pendingSourceId : undefined;
                await checkpoint({ afterId, pendingSourceId, retryAt: error.retryAt ?? new Date(now() + favoriteProviderRecoveryMinimumDelayMs).toISOString() });
                await restore();
                return recovered;
              }
              await recordReason(source.id, error instanceof PublicDiscoveryError ? error.code : 'INTERNAL_FAILURE');
            }
          }
          afterId = source.id;
          await checkpoint({ afterId }); // Every interpreted result survives suspension independently.
        }
        if (page.length < 100) {
          await writeFavoriteProviderRecoveryCursor(dependencies.checkpointStorage, undefined);
          await dependencies.alarms.clear(favoriteProviderRecoveryAlarmName);
          return recovered;
        }
      }
    } finally { dependencies.client.setDeadline?.(Infinity); }
  };
  return { restore, run(start = false): Promise<number> {
    if (inFlight !== undefined) return inFlight;
    inFlight = run(start).finally(() => { inFlight = undefined; });
    return inFlight;
  } };
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
  get?(name: string): Promise<{ scheduledTime: number } | undefined>;
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
