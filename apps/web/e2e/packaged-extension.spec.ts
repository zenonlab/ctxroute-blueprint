import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
    attributes: { altTitles: [], contentRating: 'safe', originalLanguage: 'ja', tags: [{ attributes: { group: 'genre', name: { en: 'Adventure' } } }], title: { en: 'Fixture Garden' }, year: 2021 },
    id: mangaDexId, relationships: [{ attributes: { fileName: 'fixture.jpg' }, id: '12345678-1234-4234-8234-123456789abd', type: 'cover_art' }], type: 'manga',
  },
  result: 'ok',
};

test('the packaged Chrome extension imports, resolves, bridges and survives offline', async () => {
  test.setTimeout(90_000);
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
      await route.fulfill({ body: JSON.stringify(search ? { results: [{ record: mangaUpdatesSeries }], total_hits: 1 } : mangaUpdatesSeries), contentType: 'application/json', status: 200 });
    });
    await context.route('https://api.mangadex.org/**', async (route) => {
      await route.fulfill({ body: JSON.stringify(mangaDexPayload), contentType: 'application/json', status: 200 });
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
      await chrome.bookmarks.create({ title: 'Fixture River Chapter 12', url: 'https://fixtures.tobirink.invalid/manga/fixture-river/chapter-12' });
      await chrome.bookmarks.create({ title: 'Fixture Garden Chapter 8', url: 'https://mangadex.org/title/12345678-1234-4234-8234-123456789abc/fixture-garden' });
      await chrome.bookmarks.create({ title: 'Fixture Sky Episode 4', url: 'https://fixtures.tobirink.invalid/anime/fixture-sky/episode-4' });
      await chrome.bookmarks.create({ title: 'Fixture Paper Chapter 9', url: 'https://fixtures.tobirink.invalid/manga/fixture-paper/chapter-9' });
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
    await expect(privateLibrary.getByText('CES STREAMERS')).toHaveCount(0);
    for (const host of ['s4.anilist.co', 'cdn.mangaupdates.com', 'uploads.mangadex.org', 'media.kitsu.app']) {
      await expect(privateLibrary.locator(`img[src^="https://${host}/"]`).first()).toHaveAttribute('alt', /Couverture/u);
    }
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
  } finally {
    await context.close();
  }
});
