import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'tobirink-installed-review-'));
const context = await chromium.launchPersistentContext(profile, {
  args: ['--enable-unsafe-extension-debugging'],
  ignoreDefaultArgs: ['--disable-extensions'],
  channel: 'chromium', headless: true,
});

try {
  process.stdout.write(`Installed-test browser: ${context.browser()?.version()}\n`);
  await context.route('https://graphql.anilist.co/**', (route) => route.fulfill({ status: 503, body: 'Synthetic provider outage' }));
  await context.route('https://tobirink.com/**', (route) => route.fulfill({ status: 503, body: 'Synthetic collective outage' }));
  const page = await context.newPage();
  const debugging = await context.browser().newBrowserCDPSession();
  const { id: extensionId } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const health = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'health.check', version: 1 }));
  assert.equal(health.ok, true);
  await page.evaluate(() => globalThis.chrome.bookmarks.create({ title: 'Synthetic ordinary video', url: 'https://www.youtube.com/watch?v=synthetic' }));
  await page.waitForFunction(async () => {
    const response = await globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 });
    return response.ok && response.counts.unsupported === 1;
  }, undefined, { timeout: 15000 });
  await page.evaluate(() => globalThis.chrome.bookmarks.create({ title: 'Synthetic anime reference', url: 'https://anilist.co/anime/123' }));
  await page.waitForFunction(async () => {
    const response = await globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 });
    return response.ok && response.counts.retryable === 1;
  }, undefined, { timeout: 20000 });
  const queue = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'review.queue.read', version: 1 }));
  assert.deepEqual(queue, { ok: true, snapshot: { items: [], status: 'pending' } });
  const reviewCount = await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = globalThis.indexedDB.open('tobirink-private');
    opening.onerror = () => reject(new Error('Private database unavailable.'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('reviews', 'readonly');
      const request = transaction.objectStore('reviews').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Review count unavailable.'));
      transaction.oncomplete = () => database.close();
    };
  }));
  assert.equal(reviewCount, 0);
  await page.getByRole('button', { name: 'Actualiser l’état' }).click();
  await page.getByRole('heading', { name: 'Analyse des favoris' }).waitFor();
  assert.match(await page.locator('dl').innerText(), /Liens non pris en charge/u);
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: health, unsupported bookmark, retryable provider outage, zero imported Review, private status UI passed.\n`);
} finally {
  await context.close();
}
