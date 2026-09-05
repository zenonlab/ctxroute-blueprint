import { validatePrivateSnapshot } from '../../../application/src/recovery/private-export';
import type { PrivateSnapshot, RecoveryStorePort } from '../../../application/src/recovery/private-export';

export class MemoryRecoveryStore implements RecoveryStorePort {
  private snapshot: PrivateSnapshot;
  replaceCount = 0;
  failNextReplace = false;

  constructor(initial: PrivateSnapshot) {
    this.snapshot = validatePrivateSnapshot(initial);
  }

  async readSnapshot(): Promise<PrivateSnapshot> {
    return structuredClone(this.snapshot);
  }

  async replaceSnapshot(snapshot: PrivateSnapshot): Promise<void> {
    const next = validatePrivateSnapshot(structuredClone(snapshot));
    if (this.failNextReplace) {
      this.failNextReplace = false;
      throw new Error('simulated atomic replacement failure');
    }
    this.snapshot = next;
    this.replaceCount += 1;
  }
}
