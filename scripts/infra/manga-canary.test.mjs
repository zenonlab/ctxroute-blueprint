/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runDiscoveryCanaries } from './manga-canary.mjs';

function fixtureFetcher({ initial = 'MISS', admission = 'PENDING', terminal = 'VERIFIED', admissionStatus = 202 } = {}) {
  const admitted = new Map();
  const calls = [];
  return {
    calls,
    async fetcher(url, init) {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url.endsWith('/requests')) {
        admitted.set(body.key.fingerprint, body.query);
        return Response.json({ state: admission }, { status: admissionStatus });
      }
      const key = body.keys[0];
      const query = admitted.get(key.fingerprint);
      const state = query === undefined ? { state: initial } : terminal === 'VERIFIED'
        ? { state: terminal, profile: {
          candidate: { mediaKind: key.mediaKind, titles: query.sourceTitles },
          references: [{ provider: key.mediaKind === 'ANIME' ? 'anilist' : 'mangaupdates', externalId: '1' }],
        } } : { state: terminal };
      return Response.json([{ key, state }]);
    },
  };
}

test('new anime and manga keys prove MISS to PENDING to VERIFIED with two admissions only', async () => {
  const fixture = fixtureFetcher();
  const reports = [];
  let time = 0;
  const results = await runDiscoveryCanaries({ fetcher: fixture.fetcher, nonce: 'test-run-one', now: () => time, wait: ms => { time += ms; }, report: row => reports.push(row) });
  assert.deepEqual(results.map(row => [row.media, row.state]), [['ANIME', 'VERIFIED'], ['MANGA', 'VERIFIED']]);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 2);
  assert.equal(fixture.calls.length, 6);
  assert.deepEqual(results.map(row => row.elapsedMs), [15_000, 15_000]);
  assert.doesNotMatch(JSON.stringify(reports), /fingerprint|Cowboy|One Piece|https:/u);
  const second = fixtureFetcher();
  await runDiscoveryCanaries({ fetcher: second.fetcher, nonce: 'test-run-two', wait: () => {}, report: () => {} });
  assert.notEqual(fixture.calls[0].body.keys[0].fingerprint, second.calls[0].body.keys[0].fingerprint);
});

test('cached initial or admitted VERIFIED cannot falsely certify a fresh provider run', async () => {
  for (const options of [{ initial: 'VERIFIED' }, { admission: 'VERIFIED' }]) {
    const fixture = fixtureFetcher(options);
    await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {} }), /not-fresh|admission-not-pending/u);
    assert.ok(fixture.calls.filter(call => call.url.endsWith('/requests')).length <= 1);
  }
});

test('terminal failure or 429 stops immediately without rearming or retrying admission', async () => {
  for (const options of [{ terminal: 'UNAVAILABLE' }, { terminal: 'NOT_FOUND' }, { admissionStatus: 429 }]) {
    const fixture = fixtureFetcher(options);
    await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {} }), /terminal|submit-http-429/u);
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
  }
});

test('an indefinitely pending request stops at the finite observation budget', async () => {
  const fixture = fixtureFetcher({ terminal: 'PENDING' });
  let waits = 0;
  await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => { waits += 1; }, report: () => {} }), /observation-timeout-ANIME/u);
  assert.equal(waits, 40);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
});
