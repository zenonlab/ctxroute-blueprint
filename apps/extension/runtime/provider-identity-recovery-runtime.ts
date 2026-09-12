import { finishProviderIdentityScan, readProviderIdentitySnapshots, restoreProviderIdentities, scanHydratedProviderIds } from '@tobirink/application';
import type { FavoriteCollectiveKey, FavoriteCollectiveLookupResult, ProviderIdentityRecoveryDependencies, ProviderIdentityRestoreResult, ProviderIdentitySyncPort, ProviderIdentitySyncPublisher, ProviderIdentitySyncResult, SyncedProviderAssociation } from '@tobirink/application';

export interface ProviderIdentityRecoveryRuntime {
  lookup(keys: readonly FavoriteCollectiveKey[]): Promise<readonly FavoriteCollectiveLookupResult[]>;
  prepare(): Promise<ProviderIdentityRestoreResult>;
  publish(): Promise<ProviderIdentitySyncResult | { readonly kind: 'SCANNING' }>;
}

export function createProviderIdentityRecoveryRuntime(dependencies: ProviderIdentityRecoveryDependencies & { readonly sync: ProviderIdentitySyncPort; readonly publisher: Pick<ProviderIdentitySyncPublisher, 'publish'> }): ProviderIdentityRecoveryRuntime {
  let synchronizedAssociations: readonly SyncedProviderAssociation[] = [];
  return {
    async lookup(keys) {
      return keys.map((key) => {
        const association = synchronizedAssociations.find((item) => item.fingerprint === key.fingerprint
          && (key.mediaKind === 'UNKNOWN' || item.mediaKind === key.mediaKind));
        return association === undefined
          ? { fingerprint: key.fingerprint, kind: 'MISS' as const }
          : { fingerprint: key.fingerprint, kind: 'FOUND' as const, mediaKind: association.mediaKind, references: association.references, scope: 'owner' as const };
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
      const scan = await scanHydratedProviderIds(dependencies.storage, dependencies.checkpoints);
      if (!scan.complete) return { kind: 'SCANNING' };
      const result = await dependencies.publisher.publish(scan.ids);
      if (result.kind === 'PUBLISHED' || result.kind === 'UNCHANGED') await finishProviderIdentityScan(dependencies.checkpoints);
      return result;
    },
  };
}
