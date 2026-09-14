import { publicDiscoveryKeySchema, type PublicDiscoveryKey, type PublicDiscoveryLocalRecord, type PublicDiscoveryLocalStore } from '@tobirink/application';
import type { TobirinkDatabase } from '../database';

function id(key: PublicDiscoveryKey): string {
  return JSON.stringify([key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion]);
}

export class DexiePublicDiscoveryStore implements PublicDiscoveryLocalStore {
  constructor(private readonly database: TobirinkDatabase) {}

  async read(input: PublicDiscoveryKey): Promise<PublicDiscoveryLocalRecord | undefined> {
    const key = publicDiscoveryKeySchema.parse(input);
    return this.database.publicDiscoveryStates.get(id(key));
  }

  async save(record: PublicDiscoveryLocalRecord): Promise<void> {
    await this.database.publicDiscoveryStates.put(structuredClone(record));
  }

  async listProposalPending(limit: number): Promise<readonly PublicDiscoveryLocalRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new RangeError('Public discovery maintenance limit must be between 1 and 20.');
    return this.database.publicDiscoveryStates.where('state').equals('PROPOSAL_PENDING').limit(limit).toArray();
  }
}
