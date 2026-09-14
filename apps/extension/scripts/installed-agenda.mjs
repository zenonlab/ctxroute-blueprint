import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installedAgendaFixture, seedInstalledAgenda } from './installed-agenda-fixture.mjs';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'tobirink-installed-agenda-'));
const context = await chromium.launchPersistentContext(profile, { args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'], channel: 'chromium', headless: true });

try {
  const debugging = await context.browser().newBrowserCDPSession();
  const { id } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/agenda.html`);
  await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ sort: 'TITLE_ASC', type: 'library.catalogue.read', version: 1 }));
  const fixture = installedAgendaFixture();
  await page.evaluate(seedInstalledAgenda, fixture);
  const response = await page.evaluate((period) => globalThis.chrome.runtime.sendMessage({ ...period, type: 'agenda.period.read', version: 1 }), fixture.period);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.ok(response.snapshot.items.some((item) => item.mediaType === 'anime' && item.occursAt === fixture.events[0].occurrence.value), JSON.stringify(response));
  assert.ok(response.snapshot.items.some((item) => item.mediaType === 'manga' && item.occursOn === fixture.events[1].occurrence.value), JSON.stringify(response));
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: local Agenda reconstructed one anime INSTANT and one manga DATE.\n`);
} finally {
  await context.close();
}
