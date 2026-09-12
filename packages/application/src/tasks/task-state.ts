export type DurableTaskState = 'READY' | 'CLAIMED' | 'EFFECT_RECORDED' | 'COMMITTED' | 'RETRY_AT' | 'BLOCKED';
export const durableTaskPayloadByteLimit = 64 * 1024;

export interface DurableTask {
  attempt: number; availableAt: string; blockedReason?: string; claimedAt?: string; claimExpiresAt?: string; claimToken?: string;
  effectRecord?: string; id: string; idempotencyKey: string; kind: string; lane: string; payload: string; retryAt?: string; state: DurableTaskState;
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

function payload(value: string): string {
  if (new TextEncoder().encode(value).length > durableTaskPayloadByteLimit) throw new Error(`payload exceeds ${durableTaskPayloadByteLimit} UTF-8 bytes.`);
  return value;
}

export function createDurableTask(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'> & Partial<Pick<DurableTask, 'lane'>>): DurableTask {
  return Object.freeze({ attempt: 0, availableAt: '1970-01-01T00:00:00.000Z', id: required(input.id, 'id'), idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'), kind: required(input.kind, 'kind'), lane: required(input.lane ?? 'default', 'lane'), payload: payload(input.payload), state: 'READY' });
}

export function createScheduledDurableTask(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'> & Partial<Pick<DurableTask, 'lane'>>, availableAt: string): DurableTask {
  instant(availableAt, 'availableAt');
  return Object.freeze({ ...createDurableTask(input), availableAt, retryAt: availableAt, state: 'RETRY_AT' });
}

export function isTaskAvailable(task: DurableTask, now: string): boolean {
  const current = instant(now, 'now');
  if (task.state === 'READY' || task.state === 'RETRY_AT') return instant(task.availableAt, 'availableAt') <= current;
  return task.state === 'CLAIMED' && task.claimExpiresAt !== undefined && instant(task.claimExpiresAt, 'claimExpiresAt') <= current;
}

export function claimTask(task: DurableTask, claimToken: string, claimedAt: string, claimExpiresAt: string): DurableTask {
  if (!isTaskAvailable(task, claimedAt)) throw new Error('Task is not available.');
  if (instant(claimExpiresAt, 'claimExpiresAt') <= instant(claimedAt, 'claimedAt')) throw new Error('Claim expiry must follow claim time.');
  return Object.freeze({ attempt: task.attempt + 1, availableAt: claimExpiresAt, claimedAt, claimExpiresAt, claimToken: required(claimToken, 'claimToken'), id: task.id, idempotencyKey: task.idempotencyKey, kind: task.kind, lane: task.lane, payload: task.payload, state: 'CLAIMED' });
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
  return Object.freeze({ attempt: task.attempt, availableAt: retryAt, id: task.id, idempotencyKey: task.idempotencyKey, kind: task.kind, lane: task.lane, payload: task.payload, retryAt, state: 'RETRY_AT' });
}

export function blockTask(task: DurableTask, token: string, reason: string): DurableTask {
  requireClaim(task, token, 'CLAIMED');
  return Object.freeze({ attempt: task.attempt, availableAt: task.availableAt, blockedReason: required(reason, 'reason'), id: task.id, idempotencyKey: task.idempotencyKey, kind: task.kind, lane: task.lane, payload: task.payload, state: 'BLOCKED' });
}

export function resetBlockedTask(task: DurableTask, availableAt: string): DurableTask {
  if (task.state !== 'BLOCKED') throw new Error('Task must be BLOCKED before retry reset.');
  instant(availableAt, 'availableAt');
  return Object.freeze({
    attempt: 0,
    availableAt,
    id: task.id,
    idempotencyKey: task.idempotencyKey,
    kind: task.kind,
    lane: task.lane,
    payload: task.payload,
    retryAt: availableAt,
    state: 'RETRY_AT',
  });
}

export function restoreDurableTask(task: DurableTask): DurableTask {
  if (!Number.isSafeInteger(task.attempt) || task.attempt < 0) throw new Error('attempt must be a non-negative safe integer.');
  if (!['READY', 'CLAIMED', 'EFFECT_RECORDED', 'COMMITTED', 'RETRY_AT', 'BLOCKED'].includes(task.state)) throw new Error('state is invalid.');
  const availableAt = task.availableAt ?? task.retryAt ?? '1970-01-01T00:00:00.000Z';
  instant(availableAt, 'availableAt');
  required(task.id, 'id'); required(task.idempotencyKey, 'idempotencyKey'); required(task.kind, 'kind'); required(task.lane, 'lane');
  payload(task.payload);
  if (task.state === 'RETRY_AT') {
    if (task.retryAt === undefined || instant(task.retryAt, 'retryAt') !== instant(availableAt, 'availableAt')) throw new Error('RETRY_AT requires matching retryAt and availableAt.');
  }
  if (task.state === 'CLAIMED' || task.state === 'EFFECT_RECORDED' || task.state === 'COMMITTED') {
    if (task.claimedAt === undefined || task.claimExpiresAt === undefined || task.claimToken === undefined) throw new Error(`${task.state} requires claim metadata.`);
    if (instant(task.claimExpiresAt, 'claimExpiresAt') <= instant(task.claimedAt, 'claimedAt')) throw new Error('Claim expiry must follow claim time.');
    required(task.claimToken, 'claimToken');
  }
  if (task.state === 'EFFECT_RECORDED' || task.state === 'COMMITTED') required(task.effectRecord ?? '', 'effectRecord');
  if (task.state === 'BLOCKED') required(task.blockedReason ?? '', 'blockedReason');
  return Object.freeze({ ...task, availableAt });
}
