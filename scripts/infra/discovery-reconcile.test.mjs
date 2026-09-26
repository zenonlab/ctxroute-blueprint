/* global Response */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runDiscoveryReconciliation } from './discovery-reconcile.mjs';

const submission = (marker) => ({ key: { fingerprint: marker.padStart(64, '0'), mediaKind: 'ANIME', parserVersion: 'favorite-parser-v5', siteRulesVersion: 'source-adapter-v3' }, query: { discoveryTitles: [`Work ${marker}`], mediaKind: 'ANIME', sourceTitles: [`Work ${marker}`] }, schemaVersion: 3 });

test('dry-run never calls the Worker and applies the hard selection bound', async () => {
  let calls = 0;
  const result = await runDiscoveryReconciliation({ baseUrl: 'https://tobirink.com', maxAdmissions: 2, submissions: [submission('a'), submission('b'), submission('c')] }, async () => { calls += 1; });
  assert.deepEqual(result, { attempted: 0, accepted: 0, deduplicated: 0, selected: 2, stopped: undefined, dryRun: true });
  assert.equal(calls, 0);
});

test('a large private corpus remains safe because only the bounded lot is selected', async () => {
  const submissions = Array.from({ length: 51 }, (_, index) => submission(index.toString(16).padStart(2, '0')));
  const result = await runDiscoveryReconciliation({ baseUrl: 'https://tobirink.com', maxAdmissions: 50, submissions }, async () => { throw new Error('dry-run must not call the Worker'); });
  assert.equal(result.selected, 50);
  assert.equal(result.attempted, 0);
});

test('distinct v3 keys may share a fingerprint without being collapsed', async () => {
  const first = submission('a');
  const second = { ...first, key: { ...first.key, mediaKind: 'MANGA' }, query: { ...first.query, mediaKind: 'MANGA' } };
  const result = await runDiscoveryReconciliation({ baseUrl: 'https://tobirink.com', maxAdmissions: 2, submissions: [first, second] });
  assert.equal(result.selected, 2);
});

test('apply sends one POST per key and stops on Queue backoff', async () => {
  const calls = [];
  const result = await runDiscoveryReconciliation({ baseUrl: 'https://tobirink.com', dryRun: false, maxAdmissions: 10, submissions: [submission('a'), submission('b'), submission('c')] }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(calls.length === 1 ? { state: 'PENDING' } : { error: 'discovery-queue-unavailable' }), { status: calls.length === 1 ? 202 : 503, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(result.accepted, 1);
  assert.equal(result.attempted, 2);
  assert.equal(result.stopped, 'queue-or-capacity-unavailable');
  assert.deepEqual(calls.map(({ body }) => body.key.fingerprint), ['a'.padStart(64, '0'), 'b'.padStart(64, '0')]);
});

test('apply stops immediately on provider rate limiting', async () => {
  let calls = 0;
  const result = await runDiscoveryReconciliation({ baseUrl: 'https://tobirink.com', dryRun: false, maxAdmissions: 10, submissions: [submission('a'), submission('b')] }, async () => { calls += 1; return new Response('{}', { status: 429 }); });
  assert.equal(result.attempted, 1);
  assert.equal(result.stopped, 'rate-limited');
  assert.equal(calls, 1);
});
