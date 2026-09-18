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
const previousArchive = process.argv[3];
if (archive !== undefined) {
  const bytes = await readFile(previousArchive ?? archive);
  extensionPath = await mkdtemp(join(tmpdir(), 'tobirink-installed-archive-'));
  const extraction = spawnSync('unzip', ['-q', previousArchive ?? archive, '-d', extensionPath], { encoding: 'utf8' });
  if (extraction.status !== 0) throw new Error('Test archive extraction failed.');
  process.stdout.write(`Installed archive SHA-256: ${createHash('sha256').update(bytes).digest('hex')}\n`);
}
const profile = await mkdtemp(join(tmpdir(), 'tobirink-installed-review-'));
const launchOptions = {
  args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP tobirink.com 127.0.0.1, MAP graphql.anilist.co 127.0.0.1, MAP api.mangaupdates.com 127.0.0.1'],
  ignoreDefaultArgs: ['--disable-extensions'],
  channel: 'chromium', headless: true,
};
let context = await chromium.launchPersistentContext(profile, launchOptions);

try {
  await context.setOffline(true);
  process.stdout.write(`Installed-test browser: ${context.browser()?.version()}\n`);
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
    for (let index = 0; index < 1393; index += 1) {
      await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: `Synthetic corpus ${index}`, url: `https://reader.invalid/manga/synthetic-corpus-${index}/42` });
    }
    for (let index = 0; index < 132; index += 1) {
      await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: `Synthetic utility ${index}`, url: `https://reader.invalid/search/synthetic-${index}` });
    }
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic anime reference', url: 'https://anilist.co/anime/1233' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic pending manga', url: 'https://www.mangaupdates.com/series/abc123/synthetic-pending-manga' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic pending manhwa 006', url: 'https://manhwaz.com/webtoon/synthetic-pending-manhwa-006/chapter-66.1' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic cache anime', url: 'https://reader.example/anime/synthetic-cache-anime' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Synthetic rescued manga Chapter 31', url: 'https://reader.example/view/9384/chapter/31' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: '0906168628 Genius of the Unique Lineage', url: 'https://www.asurascans.com/0906168628-genius-of-the-unique-lineage-chapter-31/' });
    await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: 'Artifact Reading Appraiser | Chapter 18 | Void Scans', url: 'https://void-scans.com/1/artifact-reading-appraiser-chapter-18/' });
  });
  const { id: extensionId } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const health = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'health.check', version: 1 }));
  assert.equal(health.ok, true);
  let status;
  for (let pass = 0; pass < 750; pass += 1) {
    status = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
    if (status.ok && status.inventory.status === 'complete' && status.counts.processing === 0) break;
    await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.reconcile', version: 1 }));
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
  assert.equal(status?.ok, true);
  assert.equal(status.inventory.status, 'complete');
  assert.equal(status.counts.observed, 1532);
  assert.equal(status.counts.unsupported, 132);
  process.stdout.write(`Installed offline diagnostics: counts=${JSON.stringify(status.counts)}\n`);
  const catalogue = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_ASC' }));
  assert.equal(catalogue.ok, true);
  assert.equal(catalogue.snapshot.statistics.total, 1400);
  assert.ok(catalogue.snapshot.items.every((item) => item.state === 'retryable'));
  assert.equal(status.counts.retryable, 1400);
  assert.equal(status.counts.resolved, 0);
  assert.equal(status.counts.blocked, 0);
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
  if (previousArchive !== undefined) {
    const oldVersion = await page.evaluate(() => globalThis.chrome.runtime.getManifest().version);
    await context.close();
    const upgrade = spawnSync('unzip', ['-oq', archive, '-d', extensionPath], { encoding: 'utf8' });
    assert.equal(upgrade.status, 0, 'Candidate must replace only the temporary unpacked fixture.');
    context = await chromium.launchPersistentContext(profile, launchOptions);
    await context.setOffline(true);
    const reloaded = await context.browser().newBrowserCDPSession();
    const { id } = await reloaded.send('Extensions.loadUnpacked', { path: extensionPath });
    assert.equal(id, extensionId, 'Upgrade must preserve extension identity.');
    page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    const version = await page.evaluate(() => globalThis.chrome.runtime.getManifest().version);
    assert.notEqual(version, oldVersion);
    const retained = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
    assert.equal(retained.ok, true);
    assert.equal(retained.counts.observed, 1532);
    assert.equal(retained.counts.resolved, 0);
    const library = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_ASC' }));
    assert.equal(library.ok, true);
    assert.equal(library.snapshot.statistics.total, 1400);
    assert.ok(library.snapshot.items.every((item) => item.state === 'retryable'));
    process.stdout.write(`Preserved profile upgrade ${oldVersion} -> ${version}: 1532 sources and 1400 offline media retained.\n`);
  }
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: 1532 bookmarks including 1400 media, offline retry without false resolution, zero blocked tasks and zero imported Review passed.\n`);
} finally {
  await context.close();
}
