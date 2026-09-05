import test from 'node:test';
import assert from 'node:assert/strict';
import { applyApprovedPlan, assertApplicablePlan, canonicalJson, createOperationPlan } from './provider-gate-core.mjs';

const now = new Date('2026-09-05T12:00:00.000Z');
const input = {
  driverId: 'provider-driver',
  accountId: 'account-1',
  inspection: { revision: 'remote-1' },
  preview: { bundle: 'sha256:abc' },
  actions: [{ kind: 'deploy', target: 'worker:public-api' }],
  now,
};

test('canonical JSON and plan digests are deterministic', () => {
  assert.equal(canonicalJson({ z: 1, a: { d: 2, b: 1 } }), canonicalJson({ a: { b: 1, d: 2 }, z: 1 }));
  assert.deepEqual(createOperationPlan(input), createOperationPlan({ ...input, inspection: { revision: 'remote-1' } }));
});

test('an exact fresh plan passes its account and resource allowlists', () => {
  const plan = createOperationPlan(input);
  assert.deepEqual(assertApplicablePlan({
    plan,
    approvedDigest: plan.digest,
    accountId: 'account-1',
    resourceAllowlist: ['worker:public-api'],
    now: new Date('2026-09-05T12:01:00.000Z'),
  }), plan);
});

test('apply delegates only after every guard passes', async () => {
  const plan = createOperationPlan(input);
  const calls = [];
  const inspection = { revision: 'remote-1' };
  const preview = { bundle: 'sha256:abc' };
  const result = await applyApprovedPlan({
    driver: {
      id: 'provider-driver',
      inspect: async accountId => { calls.push({ inspect: accountId }); return inspection; },
      preview: async actions => { calls.push({ preview: actions }); return preview; },
      apply: async (actions, context) => { calls.push({ actions, context }); return ['ok']; },
    },
    plan,
    approvedDigest: plan.digest,
    accountId: 'account-1',
    resourceAllowlist: ['worker:public-api'],
    now: new Date('2026-09-05T12:01:00.000Z'),
  });
  assert.deepEqual(result, ['ok']);
  assert.deepEqual(calls, [
    { inspect: 'account-1' },
    { preview: input.actions },
    { actions: input.actions, context: { accountId: 'account-1', planDigest: plan.digest } },
  ]);
});

test('apply rejects modified, unapproved, stale, cross-account and out-of-scope plans', async () => {
  const plan = createOperationPlan(input);
  const base = { plan, approvedDigest: plan.digest, accountId: 'account-1', resourceAllowlist: ['worker:public-api'], now };
  assert.throws(() => assertApplicablePlan({ ...base, plan: { ...plan, actions: [{ kind: 'deploy', target: 'worker:other' }] } }), /modified-plan/u);
  assert.throws(() => assertApplicablePlan({ ...base, approvedDigest: '0'.repeat(64) }), /unapproved-plan/u);
  assert.throws(() => assertApplicablePlan({ ...base, now: new Date(plan.expiresAt) }), /stale-plan/u);
  assert.throws(() => assertApplicablePlan({ ...base, accountId: 'account-2' }), /account-not-allowed/u);
  assert.throws(() => assertApplicablePlan({ ...base, resourceAllowlist: ['worker:other'] }), /resource-not-allowed/u);
});

test('plans reject unknown fields, duplicate actions and excessive lifetimes', () => {
  const plan = createOperationPlan(input);
  assert.throws(() => assertApplicablePlan({
    plan: { ...plan, approval: true }, approvedDigest: plan.digest, accountId: 'account-1', resourceAllowlist: ['worker:public-api'], now,
  }), /invalid-plan-shape/u);
  assert.throws(() => createOperationPlan({ ...input, actions: [...input.actions, ...input.actions] }), /duplicate-plan-action/u);
  assert.throws(() => createOperationPlan({ ...input, ttlMs: 31 * 60 * 1000 }), /invalid-plan-ttl/u);
});

test('a mismatched driver cannot receive an approved plan', async () => {
  const plan = createOperationPlan(input);
  await assert.rejects(() => applyApprovedPlan({
    driver: { id: 'other-driver', inspect: async () => ({}), preview: async () => ({}), apply: async () => [] },
    plan,
    approvedDigest: plan.digest,
    accountId: 'account-1',
    resourceAllowlist: ['worker:public-api'],
    now,
  }), /driver-mismatch/u);
});

test('apply refuses remote drift and dry-run drift before mutation', async () => {
  const plan = createOperationPlan(input);
  const base = {
    plan, approvedDigest: plan.digest, accountId: 'account-1', resourceAllowlist: ['worker:public-api'], now,
  };
  let applied = false;
  await assert.rejects(() => applyApprovedPlan({
    ...base,
    driver: { id: 'provider-driver', inspect: async () => ({ revision: 'remote-2' }), preview: async () => input.preview, apply: async () => { applied = true; } },
  }), /provider-state-changed/u);
  await assert.rejects(() => applyApprovedPlan({
    ...base,
    driver: { id: 'provider-driver', inspect: async () => input.inspection, preview: async () => ({ bundle: 'changed' }), apply: async () => { applied = true; } },
  }), /operation-preview-changed/u);
  assert.equal(applied, false);
});
