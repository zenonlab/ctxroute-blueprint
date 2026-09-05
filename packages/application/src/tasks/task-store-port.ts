import type { DurableTask } from './task-state';
export interface TaskStorePort {
  block(id: string, token: string, reason: string): Promise<DurableTask>;
  claimNext(token: string, claimedAt: string, expiresAt: string): Promise<DurableTask | undefined>;
  commit(id: string, token: string): Promise<DurableTask>;
  enqueue(task: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'>): Promise<DurableTask>;
  get(id: string): Promise<DurableTask | undefined>;
  recordEffect(id: string, token: string, effect: string): Promise<DurableTask>;
  retry(id: string, token: string, retryAt: string): Promise<DurableTask>;
}
