export type DurableTaskState = 'READY' | 'CLAIMED' | 'EFFECT_RECORDED' | 'COMMITTED' | 'RETRY_AT' | 'BLOCKED';

export interface DurableTask {
  attempt: number; blockedReason?: string; claimedAt?: string; claimExpiresAt?: string; claimToken?: string;
  effectRecord?: string; id: string; idempotencyKey: string; kind: string; payload: string; retryAt?: string; state: DurableTaskState;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function instant(value: string, label: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${label} must be canonical.`);
  return parsed.getTime();
}

export function createDurableTask(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'>): DurableTask {
  return Object.freeze({ attempt: 0, id: required(input.id, 'id'), idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'), kind: required(input.kind, 'kind'), payload: input.payload, state: 'READY' });
}

export function isTaskAvailable(task: DurableTask, now: string): boolean {
  const current = instant(now, 'now');
  if (task.state === 'READY') return true;
  if (task.state === 'RETRY_AT') return task.retryAt !== undefined && instant(task.retryAt, 'retryAt') <= current;
  return task.state === 'CLAIMED' && task.claimExpiresAt !== undefined && instant(task.claimExpiresAt, 'claimExpiresAt') <= current;
}

export function claimTask(task: DurableTask, claimToken: string, claimedAt: string, claimExpiresAt: string): DurableTask {
  if (!isTaskAvailable(task, claimedAt)) throw new Error('Task is not available.');
  if (instant(claimExpiresAt, 'claimExpiresAt') <= instant(claimedAt, 'claimedAt')) throw new Error('Claim expiry must follow claim time.');
  return Object.freeze({ attempt: task.attempt + 1, claimedAt, claimExpiresAt, claimToken: required(claimToken, 'claimToken'), id: task.id, idempotencyKey: task.idempotencyKey, kind: task.kind, payload: task.payload, state: 'CLAIMED' });
}

function requireClaim(task: DurableTask, token: string, state: DurableTaskState): void {
  if (task.state !== state || task.claimToken !== token) throw new Error(`Task must be ${state} with the active claim.`);
}

export function recordTaskEffect(task: DurableTask, token: string, effectRecord: string): DurableTask {
  requireClaim(task, token, 'CLAIMED');
  return Object.freeze({ ...task, effectRecord: required(effectRecord, 'effectRecord'), state: 'EFFECT_RECORDED' });
}

export function commitTask(task: DurableTask, token: string): DurableTask {
  requireClaim(task, token, 'EFFECT_RECORDED');
  return Object.freeze({ ...task, state: 'COMMITTED' });
}

export function retryTask(task: DurableTask, token: string, retryAt: string): DurableTask {
  requireClaim(task, token, 'CLAIMED'); instant(retryAt, 'retryAt');
  return Object.freeze({ attempt: task.attempt, id: task.id, idempotencyKey: task.idempotencyKey, kind: task.kind, payload: task.payload, retryAt, state: 'RETRY_AT' });
}

export function blockTask(task: DurableTask, token: string, reason: string): DurableTask {
  requireClaim(task, token, 'CLAIMED');
  return Object.freeze({ attempt: task.attempt, blockedReason: required(reason, 'reason'), id: task.id, idempotencyKey: task.idempotencyKey, kind: task.kind, payload: task.payload, state: 'BLOCKED' });
}
