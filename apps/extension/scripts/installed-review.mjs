import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
let extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const archive = process.argv[2];
if (archive !== undefined) {
  const bytes = await readFile(archive);
  extensionPath = await mkdtemp(join(tmpdir(), 'tobirink-installed-archive-'));
  const extraction = spawnSync('unzip', ['-q', archive, '-d', extensionPath], { encoding: 'utf8' });
  if (extraction.status !== 0) throw new Error('Test archive extraction failed.');
  process.stdout.write(`Installed archive SHA-256: ${createHash('sha256').update(bytes).digest('hex')}\n`);
}
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
  const seederPath = await mkdtemp(join(tmpdir(), 'tobirink-bookmark-seeder-'));
  await writeFile(join(seederPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Tobirink bookmark fixture', permissions: ['bookmarks'], version: '1.0.0' }));
  await writeFile(join(seederPath, 'seed.html'), '<!doctype html><meta charset="utf-8"><script src="seed.js"></script>');
  await writeFile(join(seederPath, 'seed.js'), 'globalThis.fixtureReady = true;');
  const { id: seederId } = await debugging.send('Extensions.loadUnpacked', { path: seederPath });
  await page.goto(`chrome-extension://${seederId}/seed.html`);
  await page.waitForFunction(() => globalThis.fixtureReady === true);
  await page.evaluate(async () => {
    const folder = await globalThis.chrome.bookmarks.create({ title: 'Synthetic large library' });
    for (let index = 0; index < 1401; index += 1) {
      await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: `Synthetic ordinary video ${index}`, url: `https://www.youtube.com/watch?v=synthetic-${index}` });
    }
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic anime reference', url: 'https://anilist.co/anime/1233' });
  });
  const { id: extensionId } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const health = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'health.check', version: 1 }));
  assert.equal(health.ok, true);
  let status;
  for (let pass = 0; pass < 8; pass += 1) {
    status = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.reconcile', version: 1 }));
    if (status.ok && status.inventory.status === 'complete') break;
  }
  assert.equal(status?.ok, true);
  assert.equal(status.inventory.status, 'complete');
  assert.equal(status.counts.observed, 1402);
  assert.equal(status.counts.unsupported, 1401);
  assert.equal(status.counts.retryable, 1);
  const continuation = await page.evaluate(() => globalThis.chrome.alarms.get('tobirink-favorite-resolution-continuation-v1'));
  assert.ok(Number.isFinite(continuation?.scheduledTime));
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
  await page.getByText('Lire les favoris du navigateur', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Vérifier à nouveau' }).waitFor();
  assert.match(await page.locator('dl').innerText(), /Liens non pris en charge/u);
  await page.getByRole('button', { name: 'Désactiver le diagnostic' }).click();
  await page.getByRole('button', { name: 'Activer le diagnostic' }).waitFor();
  const diagnosticLock = await page.evaluate(() => globalThis.chrome.storage.local.get('tobirink.extensionDiagnostics'));
  assert.equal(diagnosticLock['tobirink.extensionDiagnostics'], 'off');
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: health, 1402-bookmark convergence, durable retry alarm, zero imported Review, guided private status UI and diagnostic lock passed.\n`);
} finally {
  await context.close();
}
