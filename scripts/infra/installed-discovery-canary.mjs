/* global chrome */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { publicDiscoverySubmissionSchema, publicDiscoveryLookupSubmissionSchema, publicDiscoveryTerminalResolutionSchema } from '../../packages/public-discovery/src/contracts.ts';

// Operational gate: isolated profile, two fixed public fixtures, at most four admissions.
const archive = process.argv[2];
assert.ok(archive, 'Provide the candidate Chrome ZIP.');
const bytes = await readFile(archive);
const extensionPath = await mkdtemp(join(tmpdir(), 'tobirink-wire-archive-'));
assert.equal(spawnSync('unzip', ['-q', archive, '-d', extensionPath]).status, 0);
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const profile = await mkdtemp(join(tmpdir(), 'tobirink-wire-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'], channel: 'chromium', headless: true,
});
const admitted = new Set();
const seenKeys = new Set();
const admissions = new Map();
const expectedIds = new Map();
const admissionStates = { PENDING: 0, VERIFIED: 0 };
let failure;
let slowLookups = 0;
let workerPosts = 0;
let verifiedReads = 0;
function checkVerified(state, expectedId) {
  if (state.state !== 'VERIFIED') return;
  const result = publicDiscoveryTerminalResolutionSchema.parse({ state: state.state, profile: state.profile });
  assert.equal(result.profile.candidate.mediaKind, 'ANIME');
  const title = expectedId === '205' ? 'samurai champloo' : 'cowboy bebop';
  assert.ok(result.profile.candidate.titles.some(value => value.toLowerCase() === title));
  assert.ok(result.profile.references.some(ref => ref.provider === 'anilist' && ref.externalId === expectedId));
  verifiedReads += 1;
}
try {
  await context.route('**/*', async route => {
    try {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol === 'chrome-extension:') return await route.continue();
      if (url.origin !== 'https://tobirink.com') return await route.abort();
      const path = url.pathname;
      if (path === '/v3/catalogue/discoveries/lookup') {
        const body = publicDiscoveryLookupSubmissionSchema.parse(request.postDataJSON());
        body.keys.forEach(key => seenKeys.add(key.fingerprint));
        assert.ok(seenKeys.size <= 3, 'Only the two fixture identities and their prefetch key are allowed.');
        slowLookups += 1;
        await wait(6000);
        if (body.keys.some(key => !admitted.has(key.fingerprint))) {
          return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.keys.map(key => ({ key, state: { state: 'MISS' } }))) });
        }
      } else if (path === '/v3/catalogue/discoveries' && request.method() === 'GET') {
        const fingerprint = url.searchParams.get('fingerprint');
        if (!admitted.has(fingerprint)) return await route.fulfill({ status: 200, contentType: 'application/json', body: '{"state":"MISS"}' });
      } else if (path === '/v3/catalogue/discoveries/requests' && request.method() === 'POST') {
        const body = publicDiscoverySubmissionSchema.parse(request.postDataJSON());
        const expectedId = body.query.explicitProviderReference ? '205' : '1';
        const expectedTitle = expectedId === '205' ? 'samurai champloo' : 'cowboy bebop';
        assert.ok(body.query.sourceTitles.every(title => title.toLowerCase() === expectedTitle
          || (body.query.explicitProviderReference !== undefined && title === expectedId)));
        assert.equal(body.query.mediaKind, 'ANIME');
        if (body.query.explicitProviderReference) assert.deepEqual(body.query.explicitProviderReference, { provider: 'anilist', externalId: '205' });
        expectedIds.set(body.key.fingerprint, expectedId);
        const count = (admissions.get(body.key.fingerprint) ?? 0) + 1;
        admissions.set(body.key.fingerprint, count);
        assert.ok(admissions.size <= 2 && count <= 2, 'Admission budget exhausted.');
        assert.ok(request.serviceWorker(), 'Admission must originate in the installed service worker.');
        workerPosts += 1;
        const response = await route.fetch({ timeout: 15000, maxRedirects: 0, maxRetries: 0 });
        assert.ok(response.ok(), `Admission HTTP ${response.status()}`);
        const state = await response.json();
        assert.ok(state.state === 'PENDING' || state.state === 'VERIFIED');
        admissionStates[state.state] += 1;
        checkVerified(state, expectedId);
        admitted.add(body.key.fingerprint);
        return await route.fulfill({ response });
      } else return await route.abort();
      const response = await route.fetch({ timeout: 15000, maxRedirects: 0, maxRetries: 0 });
      assert.ok(response.ok(), `Lookup HTTP ${response.status()}`);
      const body = await response.json();
      if (Array.isArray(body)) body.forEach(item => checkVerified(item.state, expectedIds.get(item.key.fingerprint)));
      else checkVerified(body, expectedIds.get(url.searchParams.get('fingerprint')));
      return await route.fulfill({ response });
    } catch (error) {
      failure ??= error;
      await route.abort().catch(() => undefined);
    }
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const seederPath = await mkdtemp(join(tmpdir(), 'tobirink-wire-seeder-'));
  await writeFile(join(seederPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Public release fixtures', permissions: ['bookmarks'], version: '1.0.0' }));
  await writeFile(join(seederPath, 'seed.html'), '<!doctype html><meta charset="utf-8">');
  const { id: seederId } = await cdp.send('Extensions.loadUnpacked', { path: seederPath });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${seederId}/seed.html`);
  await page.evaluate(async () => {
    await chrome.bookmarks.create({ title: 'Cowboy Bebop', url: 'https://reader.invalid/anime/cowboy-bebop' });
    await chrome.bookmarks.create({ title: 'Samurai Champloo', url: 'https://anilist.co/anime/205' });
  });
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  await page.goto(`chrome-extension://${id}/options.html`);
  const deadline = Date.now() + 180_000;
  let status;
  let lastReport = 0;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    status = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
    assert.equal(status.ok, true);
    if (Date.now() - lastReport > 20_000) {
      process.stdout.write(JSON.stringify({ workerPosts, admittedKeys: admitted.size, counts: status.counts }) + '\n');
      lastReport = Date.now();
    }
    if (status.counts.resolved === 2 && admitted.size === 2) break;
    await wait(1000);
  }
  if (failure) throw failure;
  assert.equal(status.counts.observed, 2);
  assert.equal(status.counts.resolved, 2);
  assert.equal(status.counts.blocked, 0);
  assert.equal(admitted.size, 2);
  assert.ok(slowLookups > 0 && workerPosts >= 2 && verifiedReads >= 2);
  process.stdout.write(JSON.stringify({ version: manifest.version, archiveSha256: createHash('sha256').update(bytes).digest('hex'), browser: context.browser().version(), coldCacheSimulated: true, prefetchDelayMs: 6000, slowLookups, workerPosts, admissionStates, verifiedReads, resolved: status.counts.resolved }) + '\n');
} finally { await context.close(); }
