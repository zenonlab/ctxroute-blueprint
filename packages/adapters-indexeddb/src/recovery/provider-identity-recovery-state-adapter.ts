import { providerIdentityRecoveryStateSchema } from '@tobirink/application';
import type { ProviderIdentityRecoveryState, ProviderIdentityRecoveryStatePort } from '@tobirink/application';
import { z } from 'zod';
import type { TobirinkDatabase } from '../database';

export const providerIdentityRecoveryRecordSchema = z.strictObject({ id: z.literal('provider-identity-recovery'), state: providerIdentityRecoveryStateSchema });
export type ProviderIdentityRecoveryRecord = z.infer<typeof providerIdentityRecoveryRecordSchema>;

export class DexieProviderIdentityRecoveryStateAdapter implements ProviderIdentityRecoveryStatePort {
  constructor(private readonly database: TobirinkDatabase) {}
  async read(): Promise<ProviderIdentityRecoveryState | undefined> {
    const record = await this.database.providerIdentityRecovery.get('provider-identity-recovery');
    return record === undefined ? undefined : providerIdentityRecoveryRecordSchema.parse(record).state;
  }
  async save(state: ProviderIdentityRecoveryState): Promise<void> {
    await this.database.providerIdentityRecovery.put(providerIdentityRecoveryRecordSchema.parse({ id: 'provider-identity-recovery', state }));
  }
}
