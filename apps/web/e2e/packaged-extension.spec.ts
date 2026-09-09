import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

test('the packaged Chrome extension imports, resolves, bridges and survives offline', async () => {
  test.setTimeout(60_000);
  const repository = resolve(import.meta.dirname, '../../..');
  const archive = resolve(repository, 'apps/extension/.output/packages/tobirink-chrome-mv3-1.0.0.zip');
  const extensionPath = mkdtempSync(resolve(tmpdir(), 'tobirink-packaged-extension-'));
  const profilePath = mkdtempSync(resolve(tmpdir(), 'tobirink-chromium-profile-'));
  execFileSync('unzip', ['-q', archive, '-d', extensionPath]);
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: 'chromium',
    headless: true,
  });
  try {
    await context.route('https://graphql.anilist.co/**', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ data: { Media: {
          format: 'TV', genres: ['Adventure'], id: 154587,
          siteUrl: 'https://anilist.co/anime/154587/frieren-beyond-journeys-end',
          synonyms: [], title: { english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン', romaji: 'Sousou no Frieren' }, type: 'ANIME',
        } } }),
        contentType: 'application/json',
        status: 200,
      });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      await chrome.bookmarks.create({ title: '(3) CES STREAMERS QUI GHOSTENT M. LE MAIRE ft. Dach', url: 'https://www.youtube.com/watch?v=fixture' });
      await chrome.bookmarks.create({ title: 'Frieren: Beyond Journey’s End', url: 'https://anilist.co/anime/154587/frieren-beyond-journeys-end' });
    });

    const privateLibrary = await context.newPage();
    await privateLibrary.goto(`chrome-extension://${extensionId}/library.html`);
    await expect.poll(async () => privateLibrary.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open('tobirink-private');
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(['favoriteArtifacts', 'favoriteResolutionTasks'], 'readonly');
      const request = transaction.objectStore('favoriteResolutionTasks').getAll();
      const artifacts = transaction.objectStore('favoriteArtifacts').getAll();
      return new Promise<boolean>((resolveState, reject) => {
        request.onsuccess = () => {
          artifacts.onsuccess = () => resolveState(
            request.result.some((task) => task.state === 'COMMITTED' && task.effectRecord === 'resolved:anilist:154587')
            && request.result.some((task) => task.state === 'COMMITTED' && task.effectRecord === 'unsupported:identity-missing')
            && artifacts.result.some((artifact) => artifact.artifact?.displayTitle === 'frieren beyond journeys end'),
          );
        };
        request.onerror = () => reject(request.error);
      });
    }), { timeout: 30_000 }).toBe(true);
    await privateLibrary.reload();
    await expect(privateLibrary.getByText('Frieren').first()).toBeVisible({ timeout: 30_000 });
    await expect(privateLibrary.getByText('CES STREAMERS')).toHaveCount(0);

    const site = await context.newPage();
    await site.goto('https://tobirink.com/library');
    await expect(site.getByText('Frieren').first()).toBeVisible({ timeout: 10_000 });
    await expect(site.getByText('CES STREAMERS')).toHaveCount(0);

    await context.setOffline(true);
    await privateLibrary.reload();
    await expect(privateLibrary.getByText('Frieren').first()).toBeVisible();
  } finally {
    await context.close();
  }
});
