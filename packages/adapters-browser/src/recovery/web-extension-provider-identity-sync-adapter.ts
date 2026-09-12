import { favoriteOwnerLocalStateSchema, privateRecoveryJournalSchema, providerIdentitySyncStateSchema, providerSyncStorageValuesSchema, providerSyncWriteValuesSchema } from '@tobirink/application';
import type { FavoriteOwnerLocalState, FavoriteOwnerLocalStatePort, PrivateRecoveryJournal, PrivateRecoveryJournalPort } from '@tobirink/application';
import type { ProviderIdentitySyncPort, ProviderIdentitySyncState, ProviderIdentitySyncStatePort, ProviderSyncItem, ProviderSyncStorageValues } from '@tobirink/application';
import { z } from 'zod';

export interface TrustedProviderIdentityStorageArea {
  get(key: string | null): Promise<ProviderSyncStorageValues>;
  remove?(keys: string[]): Promise<void>;
  set(values: ProviderSyncStorageValues): Promise<void>;
  setAccessLevel?(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export type ProviderIdentityAccessPolicy = 'native-required' | 'firefox-background-only';
async function restrictStorage(storage: TrustedProviderIdentityStorageArea, policy: ProviderIdentityAccessPolicy): Promise<void> {
  if (storage.setAccessLevel !== undefined) await storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  else if (policy === 'native-required') throw new Error('Native storage access restriction is unavailable.');
}

export class WebExtensionProviderIdentitySyncAdapter implements ProviderIdentitySyncPort {
  private readiness: Promise<void> | undefined;
  constructor(private readonly storage: TrustedProviderIdentityStorageArea, private readonly policy: ProviderIdentityAccessPolicy = 'native-required') {}
  private ready(): Promise<void> { return this.readiness ??= restrictStorage(this.storage, this.policy); }
  async readAll(): Promise<ProviderSyncStorageValues> {
    await this.ready();
    return providerSyncStorageValuesSchema.parse(await this.storage.get(null));
  }
  async write(values: Readonly<Record<string, ProviderSyncItem>>): Promise<void> {
    await this.ready();
    await this.storage.set(providerSyncWriteValuesSchema.parse(values));
  }
  async remove(keys: string[]): Promise<void> {
    await this.ready();
    const bounded = z.array(z.string().startsWith('tobirink.provider-ids.')).max(512).parse(keys);
    if (bounded.length === 0) return;
    if (this.storage.remove === undefined) throw new Error('Native storage removal is unavailable.');
    await this.storage.remove(bounded);
  }
}

const stateKey = 'tobirink-provider-identity-sync-state-v1';
export class WebExtensionProviderIdentitySyncStateAdapter implements ProviderIdentitySyncStatePort {
  private readiness: Promise<void> | undefined;
  constructor(private readonly storage: TrustedProviderIdentityStorageArea, private readonly policy: ProviderIdentityAccessPolicy = 'native-required') {}
  private ready(): Promise<void> { return this.readiness ??= restrictStorage(this.storage, this.policy); }
  async read(): Promise<ProviderIdentitySyncState | undefined> {
    await this.ready();
    const values = await this.storage.get(stateKey);
    return values[stateKey] === undefined ? undefined : providerIdentitySyncStateSchema.parse(values[stateKey]);
  }
  async save(state: ProviderIdentitySyncState): Promise<void> {
    await this.ready();
    await this.storage.set(providerSyncStorageValuesSchema.parse({ [stateKey]: providerIdentitySyncStateSchema.parse(state) }));
  }
}

export class WebExtensionFavoriteOwnerStateAdapter implements FavoriteOwnerLocalStatePort {
  private readiness: Promise<void> | undefined;
  constructor(private readonly storage: TrustedProviderIdentityStorageArea, private readonly policy: ProviderIdentityAccessPolicy = 'native-required') {}
  private ready(): Promise<void> { return this.readiness ??= restrictStorage(this.storage, this.policy); }
  async clear(): Promise<void> {
    await this.ready();
    if (this.storage.remove === undefined) throw new Error('Native storage removal is unavailable.');
    await this.storage.remove(['tobirink-owner-v2']);
  }
  async read(): Promise<FavoriteOwnerLocalState | undefined> {
    await this.ready();
    const values = await this.storage.get('tobirink-owner-v2');
    return values['tobirink-owner-v2'] === undefined ? undefined : favoriteOwnerLocalStateSchema.parse(values['tobirink-owner-v2']);
  }
  async save(state: FavoriteOwnerLocalState): Promise<void> {
    await this.ready();
    await this.storage.set(providerSyncStorageValuesSchema.parse({ 'tobirink-owner-v2': favoriteOwnerLocalStateSchema.parse(state) }));
  }
}

const privateRecoveryJournalKey = 'tobirink-private-recovery-journal-v1';
export class WebExtensionPrivateRecoveryJournalAdapter implements PrivateRecoveryJournalPort {
  private readiness: Promise<void> | undefined;
  constructor(private readonly storage: TrustedProviderIdentityStorageArea, private readonly policy: ProviderIdentityAccessPolicy = 'native-required') {}
  private ready(): Promise<void> { return this.readiness ??= restrictStorage(this.storage, this.policy); }
  async clear(): Promise<void> {
    await this.ready();
    if (this.storage.remove === undefined) throw new Error('Native storage removal is unavailable.');
    await this.storage.remove([privateRecoveryJournalKey]);
  }
  async read(): Promise<PrivateRecoveryJournal | undefined> {
    await this.ready();
    const values = await this.storage.get(privateRecoveryJournalKey);
    return values[privateRecoveryJournalKey] === undefined ? undefined : privateRecoveryJournalSchema.parse(values[privateRecoveryJournalKey]);
  }
  async save(journal: PrivateRecoveryJournal): Promise<void> {
    await this.ready();
    await this.storage.set(providerSyncStorageValuesSchema.parse({ [privateRecoveryJournalKey]: privateRecoveryJournalSchema.parse(journal) }));
  }
}
