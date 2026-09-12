import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const mangaDexId = '12345678-1234-4234-8234-123456789abc';
const anilistMedia = {
  chapters: null, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/fixture.jpg', large: null, medium: null }, endDate: { year: null }, episodes: 28,
  format: 'TV', genres: ['Adventure'], id: 154587, popularity: 250000, siteUrl: 'https://anilist.co/anime/154587/frieren-beyond-journeys-end', startDate: { year: 2023 }, status: 'FINISHED', synonyms: [],
  title: { english: "Frieren: Beyond Journey's End", native: '葬送のフリーレン', romaji: 'Sousou no Frieren' }, type: 'ANIME', volumes: null,
};
const mangaUpdatesSeries = {
  associated: [], categories: [], genres: [{ genre: 'Adventure' }], image: { url: { original: 'https://cdn.mangaupdates.com/image/fixture.jpg' } },
  series_id: 12345, status: 'Complete', title: 'Fixture River', type: 'Manhwa', url: 'https://www.mangaupdates.com/series/9ix/fixture-river', year: 2020,
};
const kitsuResource = (type: 'anime' | 'manga') => ({
  attributes: {
    abbreviatedTitles: [], ageRating: 'PG', canonicalTitle: type === 'anime' ? 'Fixture Sky' : 'Fixture Paper', nsfw: false,
    posterImage: { large: `https://media.kitsu.app/${type}/${type === 'anime' ? '1' : '2'}/poster_image/large-fixture.jpeg` },
    slug: type === 'anime' ? 'fixture-sky' : 'fixture-paper', subtype: type === 'anime' ? 'TV' : 'manga', titles: {},
  },
  id: type === 'anime' ? '1' : '2', type,
});
const mangaDexPayload = {
  data: {
    attributes: { altTitles: [], contentRating: 'safe', links: { mu: '1gdu' }, originalLanguage: 'ja', tags: [{ attributes: { group: 'genre', name: { en: 'Adventure' } } }], title: { en: 'Fixture Garden' }, year: 2021 },
    id: mangaDexId, relationships: [{ attributes: { fileName: 'fixture.jpg' }, id: '12345678-1234-4234-8234-123456789abd', type: 'cover_art' }], type: 'manga',
  },
  result: 'ok',
};

test('the packaged Chrome extension imports, resolves, bridges and survives offline', async () => {
  test.setTimeout(90_000);
  const repository = resolve(import.meta.dirname, '../../..');
  const version = JSON.parse(readFileSync(resolve(repository, 'apps/extension/package.json'), 'utf8')).version;
  const archive = resolve(repository, `apps/extension/.output/packages/tobirink-chrome-mv3-${version}.zip`);
  const extensionPath = mkdtempSync(resolve(tmpdir(), 'tobirink-packaged-extension-'));
  const profilePath = mkdtempSync(resolve(tmpdir(), 'tobirink-chromium-profile-'));
  execFileSync('unzip', ['-q', archive, '-d', extensionPath]);
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: 'chromium',
    headless: true,
  });
  try {
    let comixAnimeSearches = 0;
    const coverRequests: string[] = [];
    await context.route(/^https:\/\/(s4\.anilist\.co|cdn\.mangaupdates\.com|uploads\.mangadex\.org|media\.kitsu\.app)\//u, async (route) => {
      coverRequests.push(route.request().headers().referer ?? '');
      await route.fulfill({ body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png', status: 200 });
    });
    await context.route('https://graphql.anilist.co/**', async (route) => {
      if (route.request().postData()?.toLowerCase().includes('fixture river')) {
        comixAnimeSearches += 1;
        await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ errors: [{ message: 'Synthetic anime provider outage', status: 403 }] }) });
        return;
      }
      const exactHydration = route.request().postData()?.includes('"id":154587') === true;
      await route.fulfill({
        body: JSON.stringify(exactHydration
          ? { data: { Media: anilistMedia } }
          : { data: { Page: { media: [], pageInfo: { hasNextPage: false } } } }),
        contentType: 'application/json',
        status: 200,
      });
    });
    await context.route('https://api.mangaupdates.com/**', async (route) => {
      const search = route.request().method() === 'POST';
      const exact = new URL(route.request().url()).pathname.endsWith('/67890') ? { ...mangaUpdatesSeries, image: { url: { original: 'https://cdn.mangaupdates.com/image/fixture-garden.jpg' } }, series_id: 67890, title: 'Fixture Garden', url: 'https://www.mangaupdates.com/series/1gdu/fixture-garden' } : mangaUpdatesSeries;
      await route.fulfill({ body: JSON.stringify(search ? { results: [{ record: mangaUpdatesSeries }], total_hits: 1 } : exact), contentType: 'application/json', status: 200 });
    });
    await context.route('https://api.mangadex.org/**', async (route) => {
      const search = new URL(route.request().url()).pathname === '/manga';
      await route.fulfill({ body: JSON.stringify(search ? { result: 'ok', data: [], limit: 20, offset: 0, total: 0 } : mangaDexPayload), contentType: 'application/json', status: 200 });
    });
    await context.route('https://kitsu.io/api/edge/**', async (route) => {
      const type = route.request().url().includes('/manga') ? 'manga' : 'anime';
      const resource = kitsuResource(type);
      const search = new URL(route.request().url()).pathname.endsWith(`/${type}`);
      await route.fulfill({ body: JSON.stringify(search ? { data: [resource], links: { next: null }, meta: { count: 1 } } : { data: resource }), contentType: 'application/vnd.api+json', status: 200 });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await worker.evaluate(async () => {
      await chrome.bookmarks.create({ title: '(3) CES STREAMERS QUI GHOSTENT M. LE MAIRE ft. Dach', url: 'https://www.youtube.com/watch?v=fixture' });
      await chrome.bookmarks.create({ title: 'Frieren: Beyond Journey’s End', url: 'https://anilist.co/anime/154587/frieren-beyond-journeys-end' });
      await chrome.bookmarks.create({ title: 'Fixture River Chapter 12', url: 'https://comix.to/title/ab123-fixture-river/1234567-chapter-12' });
      await chrome.bookmarks.create({ title: 'Fixture Garden Chapter 8', url: 'https://mangadex.org/title/12345678-1234-4234-8234-123456789abc/fixture-garden' });
      await chrome.bookmarks.create({ title: 'Fixture Sky Episode 4', url: 'https://fixtures.tobirink.invalid/anime/fixture-sky/episode-4' });
      await chrome.bookmarks.create({ title: 'Fixture Paper Chapter 9', url: 'https://fixtures.tobirink.invalid/manga/fixture-paper/chapter-9' });
    });

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(optionsPage.getByText('Favoris observés')).toBeVisible();
    const reconcileAction = optionsPage.getByRole('button', { name: /^(Commencer l’analyse|Reprendre maintenant|Vérifier à nouveau)$/u });
    await reconcileAction.click();
    await expect(reconcileAction).toBeEnabled({ timeout: 60_000 });
    await expect(optionsPage.getByText('Inventaire vérifié').first()).toBeVisible();
    await expect(optionsPage.locator('dl').getByText('6', { exact: true })).toBeVisible();
    await optionsPage.close();

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
      return new Promise<string[]>((resolveState, reject) => {
        request.onsuccess = () => resolveState(request.result
          .filter((task) => task.state === 'COMMITTED')
          .map((task) => String(task.effectRecord))
          .sort());
        request.onerror = () => reject(request.error);
      });
    }), { timeout: 60_000 }).toEqual(expect.arrayContaining([
      'resolved:anilist:154587',
      'resolved:mangaupdates:12345',
      `resolved:mangadex:${mangaDexId}`,
      'resolved:kitsu-anime:1',
      'resolved:kitsu-manga:2',
      'unsupported:identity-missing',
    ]));
    await privateLibrary.reload();
    await expect(privateLibrary.getByText('Frieren').first()).toBeVisible({ timeout: 30_000 });
    for (const title of ['Fixture River', 'Fixture Garden', 'Fixture Sky', 'Fixture Paper']) await expect(privateLibrary.getByText(title).first()).toBeVisible();
    expect(comixAnimeSearches).toBe(0);
    await expect(privateLibrary.getByText('CES STREAMERS')).toHaveCount(0);
    for (const host of ['s4.anilist.co', 'cdn.mangaupdates.com', 'media.kitsu.app']) {
      await expect(privateLibrary.locator(`img[src^="https://${host}/"]`).first()).toHaveAttribute('alt', /Couverture/u);
      await expect(privateLibrary.locator(`img[src^="https://${host}/"]`).first()).toHaveAttribute('referrerpolicy', 'no-referrer');
    }
    await expect.poll(() => privateLibrary.locator('img').evaluateAll((images) => images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    expect(coverRequests.length).toBeGreaterThanOrEqual(5);
    expect(coverRequests.every((referer) => referer === '')).toBe(true);
    await expect(privateLibrary.locator('img[src^="https://uploads.mangadex.org/"]')).toHaveCount(0);
    await expect(privateLibrary.locator('img[src^="https://cdn.mangaupdates.com/"]')).toHaveCount(2);
    expect(await privateLibrary.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
        const request = indexedDB.open('tobirink-private');
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = await new Promise<number>((resolveCount, reject) => {
        const request = database.transaction('reviews', 'readonly').objectStore('reviews').count();
        request.onsuccess = () => resolveCount(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return count;
    })).toBe(0);

    await context.setOffline(true);
    await privateLibrary.reload();
    await expect(privateLibrary.getByText('Frieren').first()).toBeVisible();

    const largeProjection = await privateLibrary.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((ready, reject) => {
        const request = indexedDB.open('tobirink-private');
        request.onsuccess = () => ready(request.result);
        request.onerror = () => reject(request.error);
      });
      const ids = Array.from({ length: 1400 }, (_, index) => `work_bulk${String(index).padStart(4, '0')}`);
      await new Promise<void>((ready, reject) => {
        const transaction = database.transaction(['works', 'libraries'], 'readwrite');
        for (const id of ids) transaction.objectStore('works').put({ id, externalReferences: [], mediaKind: 'manga', preferredTitle: id });
        const existing = transaction.objectStore('libraries').get('library_primary');
        existing.onsuccess = () => transaction.objectStore('libraries').put({ id: 'library_primary', workIds: [...(existing.result?.workIds ?? []), ...ids] });
        transaction.oncomplete = () => ready();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      return chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, query: 'work_bulk', sort: 'TITLE_ASC', offset: 1392 });
    });
    expect(largeProjection.ok).toBe(true);
    expect(largeProjection.snapshot.total).toBe(1400);
    expect(largeProjection.snapshot.items).toHaveLength(8);
    expect(largeProjection.snapshot.items.at(-1).id).toBe('work_bulk1399');
  } finally {
    await context.close();
  }
});
