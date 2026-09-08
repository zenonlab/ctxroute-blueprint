import { finishProviderIdentityScan, readProviderIdentitySnapshots, restoreProviderIdentities, scanHydratedProviderIds } from '@tobirink/application';
import type { ProviderIdentityRecoveryDependencies, ProviderIdentitySyncPort, ProviderIdentitySyncPublisher, ProviderIdentitySyncResult } from '@tobirink/application';

export interface ProviderIdentityRecoveryRuntime {
  prepare(): Promise<'READY' | 'PENDING' | 'RETRYABLE'>;
  publish(): Promise<ProviderIdentitySyncResult | { readonly kind: 'SCANNING' }>;
}

export function createProviderIdentityRecoveryRuntime(dependencies: ProviderIdentityRecoveryDependencies & { readonly sync: ProviderIdentitySyncPort; readonly publisher: Pick<ProviderIdentitySyncPublisher, 'publish'> }): ProviderIdentityRecoveryRuntime {
  return {
    async prepare() {
      try {
        const snapshot = await readProviderIdentitySnapshots(await dependencies.sync.readAll());
        if (snapshot.validGenerations === 0 && snapshot.invalidGenerations > 0) return 'RETRYABLE';
        const restored = await restoreProviderIdentities(snapshot.ids, dependencies);
        return restored.kind === 'COMPLETE' ? 'READY' : restored.kind === 'PENDING' ? 'PENDING' : 'RETRYABLE';
      } catch { return 'RETRYABLE'; }
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
