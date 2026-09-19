import { createHash } from 'node:crypto';

const PLAN_KEYS = [
  'schemaVersion',
  'gateVersion',
  'driverId',
  'accountId',
  'createdAt',
  'expiresAt',
  'inspectionDigest',
  'previewDigest',
  'options',
  'actions',
  'digest',
];
const ACTION_KEYS = ['kind', 'target'];
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_TTL_MS = 30 * 60 * 1000;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function createOperationPlan({ driverId, accountId, inspection, preview, actions, options = { preserveRoutes: false }, now = new Date(), ttlMs = DEFAULT_TTL_MS }) {
  assertIdentifier(driverId, 'driverId');
  assertIdentifier(accountId, 'accountId');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS) throw new Error('invalid-plan-ttl');
  const normalizedActions = normalizeActions(actions);
  const normalizedOptions = normalizeOptions(options);
  const createdAt = validDate(now, 'invalid-plan-created-at');
  const body = {
    schemaVersion: 1,
    gateVersion: 1,
    driverId,
    accountId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
    inspectionDigest: digest(inspection),
    previewDigest: digest(preview),
    options: normalizedOptions,
    actions: normalizedActions,
  };
  return { ...body, digest: digest(body) };
}

export function assertApplicablePlan({ plan, approvedDigest, accountId, resourceAllowlist, now = new Date() }) {
  assertExactKeys(plan, PLAN_KEYS, 'invalid-plan-shape');
  if (plan.schemaVersion !== 1 || plan.gateVersion !== 1) throw new Error('unsupported-plan-version');
  assertIdentifier(plan.driverId, 'driverId');
  assertIdentifier(plan.accountId, 'accountId');
  assertIdentifier(accountId, 'accountId');
  const createdAt = validDate(plan.createdAt, 'invalid-plan-created-at');
  const expiresAt = validDate(plan.expiresAt, 'invalid-plan-expires-at');
  const current = validDate(now, 'invalid-current-time');
  if (expiresAt <= current || createdAt > current || expiresAt.getTime() - createdAt.getTime() > MAX_TTL_MS) throw new Error('stale-plan');
  const actions = normalizeActions(plan.actions);
  normalizeOptions(plan.options);
  const body = { ...plan };
  delete body.digest;
  if (!isSha256(plan.digest) || digest(body) !== plan.digest) throw new Error('modified-plan');
  if (!isSha256(approvedDigest) || approvedDigest !== plan.digest) throw new Error('unapproved-plan');
  if (accountId !== plan.accountId) throw new Error('account-not-allowed');
  const allowed = new Set(normalizeAllowlist(resourceAllowlist));
  if (actions.some(action => !allowed.has(action.target))) throw new Error('resource-not-allowed');
  return { ...plan, actions };
}

function normalizeOptions(options) {
  if (!isRecord(options) || Object.keys(options).some(key => key !== 'preserveRoutes') || (options.preserveRoutes !== true && options.preserveRoutes !== false)) {
    throw new Error('invalid-plan-options');
  }
  return { preserveRoutes: options.preserveRoutes };
}

export async function applyApprovedPlan({ driver, plan, approvedDigest, accountId, resourceAllowlist, now }) {
  if (!isDriver(driver) || driver.id !== plan?.driverId) throw new Error('driver-mismatch');
  const verified = assertApplicablePlan({ plan, approvedDigest, accountId, resourceAllowlist, now });
  const currentInspection = await driver.inspect(verified.accountId);
  if (digest(currentInspection) !== verified.inspectionDigest) throw new Error('provider-state-changed');
  const currentPreview = await driver.preview(verified.actions);
  if (digest(currentPreview) !== verified.previewDigest) throw new Error('operation-preview-changed');
  return driver.apply(verified.actions, { accountId: verified.accountId, planDigest: verified.digest });
}

function normalizeActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0 || actions.length > 16) throw new Error('invalid-plan-actions');
  const normalized = actions.map(action => {
    assertExactKeys(action, ACTION_KEYS, 'invalid-plan-action');
    assertIdentifier(action.kind, 'action-kind');
    assertIdentifier(action.target, 'action-target');
    return { kind: action.kind, target: action.target };
  });
  if (new Set(normalized.map(action => `${action.kind}:${action.target}`)).size !== normalized.length) throw new Error('duplicate-plan-action');
  return normalized;
}

function normalizeAllowlist(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new Error('invalid-resource-allowlist');
  value.forEach(item => assertIdentifier(item, 'resource-allowlist'));
  return value;
}

function assertExactKeys(value, keys, error) {
  if (!isRecord(value)) throw new Error(error);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error(error);
}

function assertIdentifier(value, field) {
  if (value !== String(value) || value.length < 1 || value.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/u.test(value)) {
    throw new Error(`invalid-${field}`);
  }
}

function validDate(value, error) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(error);
  return date;
}

function isSha256(value) {
  return value === String(value) && /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value) {
  return value !== undefined && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function isDriver(value) {
  return isRecord(value) && ['apply', 'inspect', 'preview'].every(method => Reflect.has(value, method));
}
