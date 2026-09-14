import { finishProviderIdentityScan, readProviderIdentitySnapshots, restoreProviderIdentities, scanHydratedProviderIds } from '@tobirink/application';
import type { FavoriteIdentityKey, FavoriteIdentityLookupResult, ProviderIdentityRecoveryDependencies, ProviderIdentityRestoreResult, ProviderIdentitySyncPort, ProviderIdentitySyncPublisher, ProviderIdentitySyncResult, SyncedProviderAssociation } from '@tobirink/application';
import { workId } from '@tobirink/domain';
import type { WorkId } from '@tobirink/domain';

export interface ProviderIdentityRecoveryRuntime {
  coverRepairAfterId?(): Promise<WorkId | undefined>;
  lookup(keys: readonly FavoriteIdentityKey[]): Promise<readonly FavoriteIdentityLookupResult[]>;
  prepare(): Promise<ProviderIdentityRestoreResult>;
  publish(): Promise<ProviderIdentitySyncResult | { readonly kind: 'SCANNING' }>;
  saveCoverRepairAfterId?(afterId: WorkId | undefined): Promise<void>;
}

export const providerIdentityScanPagesPerWake = 16;

export function createProviderIdentityRecoveryRuntime(dependencies: ProviderIdentityRecoveryDependencies & { readonly sync: ProviderIdentitySyncPort; readonly publisher: Pick<ProviderIdentitySyncPublisher, 'publish'> }): ProviderIdentityRecoveryRuntime {
  let synchronizedAssociations: readonly SyncedProviderAssociation[] = [];
  return {
    async coverRepairAfterId() {
      const state = await dependencies.checkpoints.read();
      return state?.coverRepairAfterId === undefined ? undefined : workId(state.coverRepairAfterId);
    },
    async lookup(keys) {
      return keys.map((key) => {
        const association = synchronizedAssociations.find((item) => item.fingerprint === key.fingerprint
          && (key.mediaKind === 'UNKNOWN' || item.mediaKind === key.mediaKind));
        return association === undefined
          ? { fingerprint: key.fingerprint, kind: 'MISS' as const }
          : { fingerprint: key.fingerprint, kind: 'FOUND' as const, mediaKind: association.mediaKind, references: association.references };
      });
    },
    async prepare() {
      try {
        const snapshot = await readProviderIdentitySnapshots(await dependencies.sync.readAll());
        synchronizedAssociations = snapshot.ids.associations ?? [];
        if (snapshot.validGenerations === 0 && snapshot.invalidGenerations > 0) return { kind: 'RETRYABLE', hydrated: 0, retryAt: Date.now() + 60_000 };
        return restoreProviderIdentities(snapshot.ids, dependencies);
      } catch { return { kind: 'RETRYABLE', hydrated: 0, retryAt: Date.now() + 60_000 }; }
    },
    async publish() {
      let scan = await scanHydratedProviderIds(dependencies.storage, dependencies.checkpoints);
      for (let page = 1; page < providerIdentityScanPagesPerWake && !scan.complete; page += 1) {
        scan = await scanHydratedProviderIds(dependencies.storage, dependencies.checkpoints);
      }
      if (!scan.complete) return { kind: 'SCANNING' };
      const result = await dependencies.publisher.publish(scan.ids);
      if (result.kind === 'PUBLISHED' || result.kind === 'UNCHANGED') await finishProviderIdentityScan(dependencies.checkpoints);
      return result;
    },
    async saveCoverRepairAfterId(afterId) {
      const state = await dependencies.checkpoints.read() ?? { schemaVersion: 1 as const };
      await dependencies.checkpoints.save(afterId === undefined ? (({ coverRepairAfterId: _cursor, ...rest }) => rest)(state) : { ...state, coverRepairAfterId: afterId });
    },
  };
}
