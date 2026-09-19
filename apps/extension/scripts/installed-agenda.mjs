import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedAgendaFixture, seedInstalledAgenda } from './installed-agenda-fixture.mjs';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
let extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const archive = process.argv[2];
if (archive !== undefined) {
  const bytes = await readFile(archive);
  extensionPath = await mkdtemp(join(tmpdir(), 'tobirink-installed-agenda-archive-'));
  const extraction = spawnSync('unzip', ['-q', archive, '-d', extensionPath], { encoding: 'utf8' });
  if (extraction.status !== 0) throw new Error('Test archive extraction failed.');
  process.stdout.write(`Installed archive SHA-256: ${createHash('sha256').update(bytes).digest('hex')}\n`);
}
const profile = await mkdtemp(join(tmpdir(), 'tobirink-installed-agenda-'));
const context = await chromium.launchPersistentContext(profile, { args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'], channel: 'chromium', headless: true });

try {
  const fixture = installedAgendaFixture();
  let providerRequests = 0;
  let modelRequests = 0;
  let historyRequests = 0;
  await context.route('**/*', route => new URL(route.request().url()).protocol === 'chrome-extension:' ? route.continue() : route.abort());
  await context.route('https://graphql.anilist.co/**', (route) => { providerRequests += 1; return route.fulfill({ status: 503, body: 'Provider calls are forbidden in the installed Agenda smoke.' }); });
  await context.route('https://api.mangaupdates.com/**', (route) => { providerRequests += 1; return route.fulfill({ status: 503, body: 'Provider calls are forbidden in the installed Agenda smoke.' }); });
  await context.route('https://tobirink.com/v3/releases**', (route) => {
    historyRequests += 1;
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      headers: { ETag: fixture.active.etag },
      status: 200,
      body: JSON.stringify({ entries: fixture.events, generatedAt: fixture.active.checkedAt, revision: fixture.active.revision, window: { from: url.searchParams.get('from'), to: url.searchParams.get('to') } }),
    });
  });
  await context.route('https://tobirink.com/v4/release-models**', route => {
    modelRequests += 1;
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get('representation'), 'pages');
    return route.fulfill({ contentType: 'application/json', headers: { ETag: '"uninitialized"' }, status: 200,
      body: JSON.stringify({ models: [], generatedAt: '1970-01-01T00:00:00.000Z', revision: 'models-uninitialized', window: { from: url.searchParams.get('from'), to: url.searchParams.get('to') } }) });
  });
  const debugging = await context.browser().newBrowserCDPSession();
  const { id } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/agenda.html`);
  await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ sort: 'TITLE_ASC', type: 'library.catalogue.read', version: 1 }));
  await page.evaluate(seedInstalledAgenda, { ...fixture, active: undefined, events: [] });
  const response = await page.evaluate((period) => globalThis.chrome.runtime.sendMessage({ ...period, type: 'agenda.period.read', version: 1 }), fixture.period);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(response.snapshot.items.some((item) => item.mediaType === 'anime' && item.occursAt === fixture.events[0].occurrence.value), JSON.stringify(response));
  assert.ok(response.snapshot.items.some((item) => item.mediaType === 'manga' && item.occursOn === fixture.events[1].occurrence.value), JSON.stringify(response));
  assert.equal(providerRequests, 0);
  assert.ok(modelRequests > 0 && historyRequests > 0, 'Fresh installation must consume the historical fallback.');
  await context.setOffline(true);
  const offline = await page.evaluate((period) => globalThis.chrome.runtime.sendMessage({ ...period, type: 'agenda.period.read', version: 1 }), fixture.period);
  assert.equal(offline.ok, true);
  assert.deepEqual(offline.snapshot.items, response.snapshot.items);
  await page.reload();
  await page.getByText('Installed anime', { exact: true }).waitFor();
  await page.getByText('Installed manga', { exact: true }).waitFor();
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: uninitialized v4 falls back to v3; anime INSTANT and manga DATE remain available offline, with zero provider requests.\n`);
} finally {
  await context.close();
}
