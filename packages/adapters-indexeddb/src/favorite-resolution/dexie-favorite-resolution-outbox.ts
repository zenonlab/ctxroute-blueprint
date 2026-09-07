import { blockTask, claimTask, restoreDurableTask, retryTask } from '@tobirink/application';
import type { DurableTask, FavoriteResolutionClaim, FavoriteResolutionOutboxPort } from '@tobirink/application';
import Dexie from 'dexie';
import type { TobirinkDatabase } from '../database';

const claimableStates = ['READY', 'RETRY_AT', 'CLAIMED'] as const;

export class DexieFavoriteResolutionOutbox implements FavoriteResolutionOutboxPort {
  constructor(private readonly database: TobirinkDatabase) {}

  async claimNext(claim: FavoriteResolutionClaim): Promise<DurableTask | undefined> {
    return this.database.transaction('rw', this.database.favoriteResolutionTasks, async () => {
      const candidates: DurableTask[] = [];
      for (const state of claimableStates) {
        const stored = await this.database.favoriteResolutionTasks
          .where('[kind+lane+state+availableAt]')
          .between([claim.kind, claim.lane, state, Dexie.minKey], [claim.kind, claim.lane, state, claim.claimedAt], true, true)
          .first();
        if (stored !== undefined) candidates.push(restoreDurableTask(stored));
      }
      candidates.sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.id.localeCompare(right.id));
      const current = candidates[0];
      if (current === undefined) return undefined;
      const claimed = claimTask(current, claim.claimToken, claim.claimedAt, claim.claimExpiresAt);
      await this.database.favoriteResolutionTasks.put(claimed);
      return claimed;
    });
  }

  private async change(id: string, transition: (task: DurableTask) => DurableTask): Promise<DurableTask> {
    return this.database.transaction('rw', this.database.favoriteResolutionTasks, async () => {
      const stored = await this.database.favoriteResolutionTasks.get(id);
      if (stored === undefined) throw new Error(`Missing favorite resolution task ${id}.`);
      const next = transition(restoreDurableTask(stored));
      await this.database.favoriteResolutionTasks.put(next);
      return next;
    });
  }

  block(id: string, token: string, reason: string) { return this.change(id, (task) => blockTask(task, token, reason)); }
  retry(id: string, token: string, retryAt: string) { return this.change(id, (task) => retryTask(task, token, retryAt)); }
}
