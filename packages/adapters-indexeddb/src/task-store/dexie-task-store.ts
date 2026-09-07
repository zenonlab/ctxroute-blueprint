import { blockTask, claimTask, commitTask, createDurableTask, createScheduledDurableTask, isTaskAvailable, recordTaskEffect, restoreDurableTask, retryTask } from '@tobirink/application';
import type { DurableTask, TaskStorePort } from '@tobirink/application';
import Dexie from 'dexie';
import type { Table } from 'dexie';

class TaskDatabase extends Dexie {
  readonly tasks!: Table<DurableTask, string>;
  constructor(name: string) { super(name); this.version(1).stores({ tasks: '&id, &idempotencyKey, state, retryAt, claimExpiresAt' }); }
}

export class DexieTaskStore implements TaskStorePort {
  private readonly database: TaskDatabase;
  constructor(name = 'tobirink-durable-tasks') { this.database = new TaskDatabase(name); }
  async enqueue(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'> & Partial<Pick<DurableTask, 'lane'>>): Promise<DurableTask> {
    return this.database.transaction('rw', this.database.tasks, async () => {
      const existing = await this.database.tasks.where('idempotencyKey').equals(input.idempotencyKey).first();
      if (existing) return restoreDurableTask(existing);
      const task = createDurableTask(input); await this.database.tasks.add(task); return task;
    });
  }
  async schedule(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'> & Partial<Pick<DurableTask, 'lane'>>, availableAt: string): Promise<DurableTask> {
    return this.database.transaction('rw', this.database.tasks, async () => {
      const existing = await this.database.tasks.where('idempotencyKey').equals(input.idempotencyKey).first();
      if (existing) return restoreDurableTask(existing);
      const task = createScheduledDurableTask(input, availableAt); await this.database.tasks.add(task); return task;
    });
  }
  async get(id: string) { const task = await this.database.tasks.get(id); return task && restoreDurableTask(task); }
  async claimNext(token: string, claimedAt: string, expiresAt: string): Promise<DurableTask | undefined> {
    return this.database.transaction('rw', this.database.tasks, async () => {
      const pending = (await this.database.tasks.where('state').anyOf('READY', 'RETRY_AT', 'CLAIMED').toArray()).map(restoreDurableTask);
      const current = pending.filter((task) => isTaskAvailable(task, claimedAt)).sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!current) return undefined;
      const next = claimTask(current, token, claimedAt, expiresAt); await this.database.tasks.put(next); return next;
    });
  }
  private async change(id: string, transition: (task: DurableTask) => DurableTask): Promise<DurableTask> {
    return this.database.transaction('rw', this.database.tasks, async () => {
      const stored = await this.database.tasks.get(id); if (!stored) throw new Error(`Missing task ${id}.`);
      const next = transition(restoreDurableTask(stored)); await this.database.tasks.put(next); return next;
    });
  }
  recordEffect(id: string, token: string, effect: string) { return this.change(id, (task) => recordTaskEffect(task, token, effect)); }
  commit(id: string, token: string) { return this.change(id, (task) => commitTask(task, token)); }
  retry(id: string, token: string, retryAt: string) { return this.change(id, (task) => retryTask(task, token, retryAt)); }
  block(id: string, token: string, reason: string) { return this.change(id, (task) => blockTask(task, token, reason)); }
  close() { this.database.close(); }
  async deleteDatabase() { await this.database.delete(); }
}
