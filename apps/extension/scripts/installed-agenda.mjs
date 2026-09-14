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
  await context.route('https://graphql.anilist.co/**', (route) => { providerRequests += 1; return route.fulfill({ status: 503, body: 'Provider calls are forbidden in the installed Agenda smoke.' }); });
  await context.route('https://api.mangaupdates.com/**', (route) => { providerRequests += 1; return route.fulfill({ status: 503, body: 'Provider calls are forbidden in the installed Agenda smoke.' }); });
  await context.route('https://tobirink.com/v3/releases**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: 'application/json',
      headers: { ETag: fixture.active.etag },
      status: 200,
      body: JSON.stringify({ entries: fixture.events, generatedAt: fixture.active.checkedAt, revision: fixture.active.revision, window: { from: url.searchParams.get('from'), to: url.searchParams.get('to') } }),
    });
  });
  const debugging = await context.browser().newBrowserCDPSession();
  const { id } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/agenda.html`);
  await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ sort: 'TITLE_ASC', type: 'library.catalogue.read', version: 1 }));
  await page.evaluate(seedInstalledAgenda, fixture);
  const response = await page.evaluate((period) => globalThis.chrome.runtime.sendMessage({ ...period, type: 'agenda.period.read', version: 1 }), fixture.period);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(response.snapshot.items.some((item) => item.mediaType === 'anime' && item.occursAt === fixture.events[0].occurrence.value), JSON.stringify(response));
  assert.ok(response.snapshot.items.some((item) => item.mediaType === 'manga' && item.occursOn === fixture.events[1].occurrence.value), JSON.stringify(response));
  assert.equal(providerRequests, 0);
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: shared D1 Agenda reconstructed one anime INSTANT and one manga DATE with zero provider requests.\n`);
} finally {
  await context.close();
}
