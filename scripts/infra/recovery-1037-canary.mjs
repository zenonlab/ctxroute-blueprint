/* global AbortSignal, fetch, performance */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { publicDiscoverySubmissionSchema, publicDiscoveryTerminalResolutionSchema } from '../../packages/public-discovery/src/contracts.ts';

// This operational gate admits only the two public release fixtures below.
const mode = process.argv[2];
assert.ok(['read', 'submit'].includes(mode));
for (const kind of ['title', 'exact']) {
  const key = { fingerprint: createHash('sha256').update(`tobirink-release-1.0.37:${kind}`).digest('hex'), mediaKind: 'ANIME', parserVersion: 'release-canary-1.0.37', siteRulesVersion: 'canary-v1' };
  const query = { discoveryTitles: ['Cowboy Bebop'], sourceTitles: ['Cowboy Bebop'], mediaKind: 'ANIME', sourceFormat: 'NON_OVA', preSerialization: false };
  if (kind === 'exact') query.explicitProviderReference = { provider: 'anilist', externalId: '1' };
  const init = { signal: AbortSignal.timeout(15000), redirect: 'error', headers: { 'Content-Type': 'application/json' }, method: 'POST' };
  if (mode === 'read') init.body = JSON.stringify({ keys: [key], schemaVersion: 3 });
  if (mode === 'submit') init.body = JSON.stringify(publicDiscoverySubmissionSchema.parse({ key, query, schemaVersion: 3 }));
  const start = performance.now();
  const response = mode === 'read' ? await fetch('https://tobirink.com/v3/catalogue/discoveries/lookup', init) : await fetch('https://tobirink.com/v3/catalogue/discoveries/requests', init);
  const body = await response.json();
  const state = mode === 'read' ? body[0]?.state : body;
  assert.ok(response.ok, `canary-${kind}-http-${response.status}`);
  assert.ok(['MISS', 'PENDING', 'VERIFIED'].includes(state.state), `canary-${kind}-unexpected-state`);
  if (state.state === 'VERIFIED') {
    const verified = publicDiscoveryTerminalResolutionSchema.parse({ state: state.state, profile: state.profile });
    assert.equal(verified.profile.candidate.mediaKind, 'ANIME');
    assert.ok(verified.profile.candidate.titles.some(title => title.toLowerCase() === 'cowboy bebop'));
    if (kind === 'exact') assert.ok(verified.profile.references.some(reference => reference.provider === 'anilist' && reference.externalId === '1'));
  }
  process.stdout.write(JSON.stringify({ kind, state: state.state, http: response.status, durationMs: Math.round(performance.now() - start), retryAt: state.retryAt, verified: state.state === 'VERIFIED' }) + '\n');
  if (mode === 'submit' && kind === 'title') await setTimeout(7000);
}
