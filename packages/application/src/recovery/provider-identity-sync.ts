import { z } from 'zod';
import { assertProviderSyncQuota, mergeSyncedProviderIds, prepareProviderIdentitySnapshot, providerSyncQuota, readProviderIdentityGeneration, readProviderIdentitySnapshots, syncedProviderIdsSchema, syncedProviderManifestSchema } from './provider-identity-snapshot';
import type { ProviderSyncItem, ProviderSyncStorageValues, SyncedProviderIds } from './provider-identity-snapshot';

export const providerIdentitySyncStateSchema = z.strictObject({
  schemaVersion: z.literal(1), lastWriteAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pending: z.strictObject({ generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), ids: syncedProviderIdsSchema }).optional(),
});
export type ProviderIdentitySyncState = z.infer<typeof providerIdentitySyncStateSchema>;
export interface ProviderIdentitySyncPort {
  readAll(): Promise<ProviderSyncStorageValues>;
  remove(keys: string[]): Promise<void>;
  write(values: Readonly<Record<string, ProviderSyncItem>>): Promise<void>;
}
export interface ProviderIdentitySyncStatePort {
  read(): Promise<ProviderIdentitySyncState | undefined>;
  save(state: ProviderIdentitySyncState): Promise<void>;
}
export type ProviderIdentitySyncResult =
  | { readonly kind: 'UNCHANGED' | 'PUBLISHED' }
  | { readonly kind: 'DEFERRED' | 'STAGED'; readonly retryAt: number }
  | { readonly kind: 'QUOTA_EXCEEDED' | 'RETRYABLE' };

export class ProviderIdentitySyncPublisher {
  private active: Promise<void> = Promise.resolve();
  constructor(private readonly sync: ProviderIdentitySyncPort, private readonly state: ProviderIdentitySyncStatePort, private readonly now: () => number) {}

  async publish(input: SyncedProviderIds): Promise<ProviderIdentitySyncResult> {
    const ids = mergeSyncedProviderIds(input);
    const previous = this.active;
    let release: () => void = () => {};
    this.active = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await this.publishSnapshot(ids); } catch (error) {
      return error instanceof Error && error.message === 'PROVIDER_SYNC_QUOTA_EXCEEDED' ? { kind: 'QUOTA_EXCEEDED' } : { kind: 'RETRYABLE' };
    } finally { release(); }
  }

  private async publishSnapshot(input: SyncedProviderIds): Promise<ProviderIdentitySyncResult> {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid sync clock.');
    const state = providerIdentitySyncStateSchema.parse(await this.state.read() ?? { schemaVersion: 1, lastWriteAt: 0 });
    const values = await this.sync.readAll();
    const current = await readProviderIdentitySnapshots(values);
    const desired = mergeSyncedProviderIds(current.newestIds, input);
    const retryAt = state.lastWriteAt + providerSyncQuota.writeIntervalMs;
    if (state.pending === undefined && JSON.stringify(current.newestIds) === JSON.stringify(desired)) {
      if (current.obsoleteKeys.length === 0) return { kind: 'UNCHANGED' };
      if (now < retryAt) return { kind: 'DEFERRED', retryAt };
      await this.sync.remove([...current.obsoleteKeys]);
      await this.state.save({ schemaVersion: 1, lastWriteAt: now });
      return { kind: 'STAGED', retryAt: now + providerSyncQuota.writeIntervalMs };
    }
    const pending = state.pending ?? { generation: Math.max(now, current.generation + 1), ids: desired };
    const snapshot = await prepareProviderIdentitySnapshot(pending.ids, pending.generation);
    const verified = await readProviderIdentityGeneration(values, snapshot.manifest);
    const published = syncedProviderManifestSchema.safeParse(values[snapshot.manifestKey]);
    if (verified !== undefined && published.success && JSON.stringify(published.data) === JSON.stringify(snapshot.manifest)) {
      await this.state.save({ schemaVersion: 1, lastWriteAt: state.lastWriteAt });
      return { kind: 'PUBLISHED' };
    }
    if (now < retryAt) return { kind: 'DEFERRED', retryAt };
    assertProviderSyncQuota(values, { ...snapshot.fragments, [snapshot.manifestKey]: snapshot.manifest });
    await this.state.save({ schemaVersion: 1, lastWriteAt: now, pending });
    if (verified === undefined) {
      await this.sync.write(snapshot.fragments);
      return { kind: 'STAGED', retryAt: now + providerSyncQuota.writeIntervalMs };
    }
    await this.sync.write({ [snapshot.manifestKey]: snapshot.manifest });
    const confirmed = await this.sync.readAll();
    const confirmation = syncedProviderManifestSchema.safeParse(confirmed[snapshot.manifestKey]);
    if (!confirmation.success || JSON.stringify(confirmation.data) !== JSON.stringify(snapshot.manifest) || await readProviderIdentityGeneration(confirmed, snapshot.manifest) === undefined) return { kind: 'RETRYABLE' };
    await this.state.save({ schemaVersion: 1, lastWriteAt: now });
    return { kind: 'PUBLISHED' };
  }
}
