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
  let providerTitleSearches = 0;
  let publicCacheReads = 0;
  const resolutionOrder = [];
  let tobirinkRequests = 0;
  const tobirinkPaths = new Set();
  await context.route('https://graphql.anilist.co/**', async (route) => {
    if ((route.request().postData() ?? '').includes('Page(')) { providerTitleSearches += 1; resolutionOrder.push('provider-search'); }
    await route.fulfill({ status: 503, body: 'Synthetic provider outage' });
  });
  await context.route('https://api.mangaupdates.com/**', (route) => route.fulfill({ status: 503, body: 'Synthetic provider outage' }));
  await context.route('https://tobirink.com/**', (route) => { tobirinkRequests += 1; tobirinkPaths.add(new URL(route.request().url()).pathname); return route.fulfill({ status: 503, body: 'Synthetic collective outage' }); });
  await context.route(/^https:\/\/tobirink\.com\/v1\/catalogue\/favorites\/resolve\?/u, (route) => {
    publicCacheReads += 1;
    resolutionOrder.push('public-cache');
    if (new URL(route.request().url()).searchParams.get('mediaKind') !== 'ANIME') return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ identity: { mediaKind: 'ANIME', metadata: { preSerialization: false }, references: [{ externalId: '154587', provider: 'anilist' }] } }) });
  });
  await context.route('https://tobirink.com/v1/catalogue/favorites/resolve-batch', async (route) => {
    publicCacheReads += 1;
    resolutionOrder.push('public-cache');
    const keys = JSON.parse(route.request().postData() ?? '{}').keys ?? [];
    const results = keys.map((key) => key.mediaKind === 'ANIME'
      ? { fingerprint: key.fingerprint, identity: { mediaKind: 'ANIME', metadata: { preSerialization: false }, references: [{ externalId: '154587', provider: 'anilist' }] } }
      : { fingerprint: key.fingerprint });
    return route.fulfill({ contentType: 'application/json', status: 200, body: JSON.stringify({ results }) });
  });
  let page = await context.newPage();
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
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic pending manga', url: 'https://www.mangaupdates.com/series/abc123/synthetic-pending-manga' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic pending manhwa 006', url: 'https://manhwaz.com/webtoon/synthetic-pending-manhwa-006/chapter-66.1' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic cache anime', url: 'https://reader.example/anime/synthetic-cache-anime' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic rescued manga Chapter 31', url: 'https://reader.example/view/9384/chapter/31' });
  });
  const { id: extensionId } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const cacheTransportProbe = await page.evaluate(async () => {
    const response = await globalThis.fetch('https://tobirink.com/v1/catalogue/favorites/resolve?fingerprint=transport-probe&mediaKind=ANIME&parserVersion=probe&siteRulesVersion=probe', { cache: 'default', credentials: 'omit', headers: { Accept: 'application/json' }, method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' });
    return response.status;
  });
  assert.equal(cacheTransportProbe, 200);
  publicCacheReads = 0;
  const health = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'health.check', version: 1 }));
  assert.equal(health.ok, true);
  let status;
  for (let pass = 0; pass < 750; pass += 1) {
    status = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
    if (status.ok && status.inventory.status === 'complete' && status.counts.processing === 0) break;
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
  assert.equal(status?.ok, true);
  assert.equal(status.inventory.status, 'complete');
  assert.equal(status.counts.observed, 1406);
  assert.equal(status.counts.unsupported, 1401);
  process.stdout.write(`Installed cache diagnostics: cacheReads=${publicCacheReads}, tobirinkRequests=${tobirinkRequests}, paths=${[...tobirinkPaths].join(',')}, titleSearches=${providerTitleSearches}, counts=${JSON.stringify(status.counts)}\n`);
  const catalogue = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_ASC' }));
  assert.equal(catalogue.ok, true);
  assert.equal(catalogue.snapshot.statistics.total, 5, JSON.stringify(catalogue.snapshot.items));
  assert.ok(catalogue.snapshot.items.some((item) => item.title.toLocaleLowerCase() === 'synthetic pending manga' && item.mediaType === 'manga' && item.state === 'retryable'));
  assert.ok(catalogue.snapshot.items.some((item) => item.title.toLocaleLowerCase() === 'synthetic pending manhwa' && item.mediaType === 'manga' && item.state === 'retryable'), JSON.stringify(catalogue.snapshot.items));
  assert.ok(catalogue.snapshot.items.some((item) => item.title.toLocaleLowerCase() === 'synthetic cache anime' && item.state === 'ready'));
  assert.ok(catalogue.snapshot.items.some((item) => item.title.toLocaleLowerCase() === 'synthetic rescued manga' && item.mediaType === 'unknown' && item.state === 'retryable'));
  assert.equal(providerTitleSearches, 2);
  assert.ok(resolutionOrder.indexOf('public-cache') < resolutionOrder.indexOf('provider-search'));
  const targets = await debugging.send('Target.getTargets');
  const serviceWorker = targets.targetInfos.find((target) => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${extensionId}/`));
  assert.ok(serviceWorker);
  await debugging.send('Target.closeTarget', { targetId: serviceWorker.targetId });
  await new Promise((resolve) => { setTimeout(resolve, 500); });
  const restarted = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_ASC' }));
  assert.equal(restarted.ok, true);
  assert.equal(restarted.snapshot.statistics.total, 5);
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
  const paused = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.control.write', version: 1, action: 'pause' }));
  assert.equal(paused.ok, true);
  assert.equal(paused.controller.state, 'paused');
  const resumed = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.control.write', version: 1, action: 'resume' }));
  assert.equal(resumed.ok, true);
  await page.getByRole('button', { name: 'Actualiser l’état' }).click();
  await page.getByRole('heading', { name: 'Analyse des favoris' }).waitFor();
  await page.getByText('Lire les favoris du navigateur', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Vérifier à nouveau' }).waitFor();
  assert.match(await page.locator('dl').innerText(), /Liens non pris en charge/u);
  await page.getByRole('button', { name: 'Désactiver le diagnostic' }).click();
  await page.getByRole('button', { name: 'Activer le diagnostic' }).waitFor();
  const diagnosticLock = await page.evaluate(() => globalThis.chrome.storage.local.get('tobirink.extensionDiagnostics'));
  assert.equal(diagnosticLock['tobirink.extensionDiagnostics'], 'off');
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: health, automatic 1406-bookmark convergence across anime/manga/manhwa/unknown, batched D1 cache before bounded provider title searches, durable retries, pause/resume, MV3 restart, zero imported Review, guided private status UI and diagnostic lock passed.\n`);
} finally {
  await context.close();
}
