import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { restartInstalledReviewWorker } from '../../extension/scripts/installed-review.mjs';

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
  test.setTimeout(120_000);
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
    await context.route('https://tobirink.com/v3/catalogue/discoveries**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ body: JSON.stringify({ state: 'MISS' }), contentType: 'application/json', status: 200 });
        return;
      }
      // SAFETY: the request body is emitted by the extension's validated public-discovery contract.
      const body = JSON.parse(route.request().postData() ?? '{}') as { query?: { mediaKind?: string; sourceTitles?: string[] } };
      const title = body.query?.sourceTitles?.[0] ?? 'Fixture';
      const lowerTitle = title.toLowerCase();
      const provider = lowerTitle.includes('frieren') ? 'anilist' : lowerTitle.includes('river') ? 'mangaupdates' : lowerTitle.includes('garden') ? 'mangadex' : lowerTitle.includes('sky') ? 'kitsu-anime' : 'kitsu-manga';
      const mediaKind = body.query?.mediaKind === 'ANIME' ? 'ANIME' : 'MANGA';
      const candidate = { displayTitle: title, externalId: `${provider}-fixture`, mediaKind, preSerialization: false, provider, titles: [title] };
      await route.fulfill({ body: JSON.stringify({
        nextRefreshAt: '2026-10-01T00:00:00.000Z', profile: {
          candidate,
          references: [{ externalId: `${provider}-fixture`, provider }], workId: `work_${provider}_fixture`,
        }, state: 'VERIFIED', verifiedAt: '2026-09-20T00:00:00.000Z',
      }), contentType: 'application/json', status: 200 });
    });
    await context.route(/^https:\/\/(s4\.anilist\.co|cdn\.mangaupdates\.com|uploads\.mangadex\.org|media\.kitsu\.app)\//u, async (route) => {
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
    await expect(optionsPage.getByText('Favoris observés')).toBeVisible({ timeout: 60_000 });
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
      'resolved:d1-verified-discovery',
      'unsupported:identity-missing',
    ]));
    await privateLibrary.reload();
    await expect(privateLibrary.getByText('Frieren').first()).toBeVisible({ timeout: 30_000 });
    for (const title of ['Fixture River', 'Fixture Garden', 'Fixture Sky', 'Fixture Paper']) await expect(privateLibrary.getByText(title).first()).toBeVisible();
    expect(comixAnimeSearches).toBe(0);
    await expect(privateLibrary.getByText('CES STREAMERS')).toHaveCount(0);
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

for (const mediaKind of ['MANHWA', 'ANIME'] as const) test(`packaged extension preserves pending ${mediaKind} across restarts before mocked verification`, async ({ browserName }) => {
  test.setTimeout(240_000);
  expect(browserName).toBe('chromium');
  const repository = resolve(import.meta.dirname, '../../..');
  const version = JSON.parse(readFileSync(resolve(repository, 'apps/extension/package.json'), 'utf8')).version;
  const archive = process.env.TOBIRINK_TEST_ARCHIVE ?? resolve(repository, `apps/extension/.output/packages/tobirink-chrome-mv3-${version}.zip`);
  const extensionPath = mkdtempSync(resolve(tmpdir(), 'tobirink-pending-extension-'));
  const profilePath = mkdtempSync(resolve(tmpdir(), 'tobirink-pending-profile-'));
  execFileSync('unzip', ['-q', archive, '-d', extensionPath]);
  const title = 'Synthetic Continuation River';
  const bookmarkUrl = mediaKind === 'ANIME' ? 'https://anilist.co/anime/154587/synthetic-continuation-river' : 'https://manhwaz.com/webtoon/synthetic-continuation-river/chapter-7';
  const provider = mediaKind === 'ANIME' ? 'kitsu-anime' : 'mangaupdates';
  const externalId = mediaKind === 'ANIME' ? '46474' : '12345';
  const linkedReferences = mediaKind === 'ANIME' ? [{ provider: 'anilist', externalId: '154587' }] : [];
  const pendingDetail = `${mediaKind === 'ANIME' ? 'Anime' : 'Manhwa'} (source) · Traitement distant en cours`;
  const servedStates: string[] = [];
  const forbiddenRequests: string[] = [];
  let admissions = 0;
  let admittedAt = 0;
  let overduePendingObservations = 0;
  let providerCompleted = false;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let options: Page | undefined;
  const discoveryState = () => {
    if (admissions === 0) return { state: 'MISS' };
    if (!providerCompleted) {
      if (Date.now() >= admittedAt + 60_000) overduePendingObservations += 1;
      return { retryAt: new Date(admittedAt + 60_000).toISOString(), state: 'PENDING' };
    }
    return {
      state: 'VERIFIED', verifiedAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + 86_400_000).toISOString(),
      profile: {
        candidate: { displayTitle: title, externalId, mediaKind, preSerialization: false, provider, titles: [title], linkedReferences },
        references: [{ externalId, provider }, ...linkedReferences], workId: 'work_synthetic-continuation-river',
      },
    };
  };
  const launch = async () => {
    const opened = await chromium.launchPersistentContext(profilePath, {
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost'],
      channel: 'chromium', headless: true,
    });
    context = opened;
    await opened.routeWebSocket('**/*', async (socket) => {
      forbiddenRequests.push(new URL(socket.url()).origin);
      await socket.close();
    });
    await opened.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') { await route.continue(); return; }
      if (url.origin !== 'https://tobirink.com') {
        forbiddenRequests.push(url.origin);
        await route.abort('blockedbyclient');
        return;
      }
      if (url.pathname === '/v3/catalogue/discoveries/requests' && request.method() === 'POST') {
        const submission = request.postDataJSON();
        expect(submission.query.mediaKind).toBe(mediaKind);
        expect(submission.key.mediaKind).toBe(mediaKind);
        if (mediaKind === 'ANIME') expect(submission.query.explicitProviderReference).toEqual(linkedReferences[0]);
        expect(submission.query).not.toHaveProperty('url');
        admissions += 1;
        if (admissions === 1) admittedAt = Date.now();
        const state = discoveryState();
        servedStates.push(state.state);
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(state) });
        return;
      }
      if (url.pathname === '/v3/catalogue/discoveries/lookup' && request.method() === 'POST') {
        const submission = request.postDataJSON();
        expect(submission.keys).toHaveLength(1);
        const state = discoveryState();
        servedStates.push(state.state);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(submission.keys.map((key: Record<string, string>) => ({ key, state }))) });
        return;
      }
      if (url.pathname === '/v3/catalogue/discoveries' && request.method() === 'GET') {
        expect(url.searchParams.get('mediaKind')).toBe(mediaKind);
        const state = discoveryState();
        servedStates.push(state.state);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });
    return opened;
  };
  const readState = async (surface: Page) => surface.evaluate(async ({ url, mediaKind }) => ({
    bookmarks: await chrome.bookmarks.search({ url }),
    catalogue: await chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, facets: { type: { [mediaKind]: 'include' } }, sort: 'TITLE_ASC' }),
    status: await chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }),
  }), { url: bookmarkUrl, mediaKind });
  try {
    context = await launch();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const bookmark = await worker.evaluate(async (input) => chrome.bookmarks.create(input), { title, url: bookmarkUrl });
    options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole('button', { name: /^(Commencer l’analyse|Reprendre maintenant|Vérifier à nouveau)$/u }).click();
    await expect.poll(() => admissions, { timeout: 30_000 }).toBe(1);
    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    await expect.poll(async () => (await readState(options!)).status.counts?.publicDiscoveryPending, { timeout: 30_000 }).toBe(1);
    const pending = await readState(options);
    expect(pending.status.counts).toMatchObject({ observed: 1, resolved: 0, retryable: 1 });
    expect(pending.catalogue.snapshot).toMatchObject({ total: 1, items: [{ state: 'retryable', detail: pendingDetail }] });
    expect(pending.bookmarks).toMatchObject([{ id: bookmark.id, title, url: bookmarkUrl }]);
    await expect(page.getByText(pendingDetail)).toBeVisible();

    expect(await restartInstalledReviewWorker(context, options, extensionId)).toBe(true);
    const afterWorker = await readState(options);
    expect(afterWorker.catalogue.snapshot.items).toEqual(pending.catalogue.snapshot.items);
    expect(afterWorker.bookmarks).toEqual(pending.bookmarks);
    expect(afterWorker.status.counts).toMatchObject({ observed: 1, resolved: 0, publicDiscoveryPending: 1 });
    expect(admissions).toBe(1);

    await context.close();
    context = await launch();
    const resumedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    expect(new URL(resumedWorker.url()).host).toBe(extensionId);
    options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/library.html`);
    const afterBrowser = await readState(options);
    expect(afterBrowser.bookmarks).toEqual(pending.bookmarks);
    expect(afterBrowser.catalogue.snapshot.items).toEqual(pending.catalogue.snapshot.items);
    expect(afterBrowser.status.counts).toMatchObject({ observed: 1, resolved: 0, publicDiscoveryPending: 1 });
    await expect.poll(() => overduePendingObservations, { timeout: 120_000, intervals: [500, 1_000, 2_000] }).toBeGreaterThan(0);
    expect(admissions).toBe(1);
    providerCompleted = true;
    await expect.poll(async () => (await readState(options!)).status.counts?.resolved, { timeout: 100_000, intervals: [500, 1_000, 2_000] }).toBe(1);
    const verified = await readState(options);
    expect(verified.catalogue.snapshot).toMatchObject({ total: 1, items: [{ id: 'work_synthetic-continuation-river', state: 'ready', title, source: provider }] });
    expect(verified.bookmarks).toEqual(pending.bookmarks);
    expect(verified.status.counts).toMatchObject({ observed: 1, resolved: 1, processing: 0, retryable: 0 });
    expect(servedStates).toEqual(expect.arrayContaining(['MISS', 'PENDING', 'VERIFIED']));
    expect(servedStates.indexOf('MISS')).toBeLessThan(servedStates.indexOf('PENDING'));
    expect(servedStates.indexOf('PENDING')).toBeLessThan(servedStates.indexOf('VERIFIED'));
    expect(admissions).toBe(1);
    expect(forbiddenRequests).toEqual([]);

    const exchanges = servedStates.length;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    const offline = await readState(options);
    expect(offline.catalogue.snapshot.items).toEqual(verified.catalogue.snapshot.items);
    expect(offline.bookmarks).toEqual(pending.bookmarks);
    expect(offline.status.counts).toMatchObject({ observed: 1, resolved: 1 });
    expect(servedStates).toHaveLength(exchanges);
    expect(forbiddenRequests).toEqual([]);
  } finally {
    await context?.close();
  }
});

test('packaged Review verifies an ambiguous reference before committing a human association', async () => {
  test.setTimeout(90_000);
  const repository = resolve(import.meta.dirname, '../../..');
  const version = JSON.parse(readFileSync(resolve(repository, 'apps/extension/package.json'), 'utf8')).version;
  const archive = process.env.TOBIRINK_TEST_ARCHIVE ?? resolve(repository, `apps/extension/.output/packages/tobirink-chrome-mv3-${version}.zip`);
  const extensionPath = mkdtempSync(resolve(tmpdir(), 'tobirink-reference-extension-'));
  const profilePath = mkdtempSync(resolve(tmpdir(), 'tobirink-reference-profile-'));
  execFileSync('unzip', ['-q', archive, '-d', extensionPath]);
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, '--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost'],
    channel: 'chromium', headless: true, viewport: { width: 390, height: 844 },
  });
  const title = 'Synthetic Ambiguous River';
  const references = [{ provider: 'mangaupdates', externalId: '123' }, { provider: 'mangaupdates', externalId: '456' }];
  const forbiddenRequests: string[] = [];
  let automaticFingerprint: string | undefined;
  let manualPosts = 0;
  let manualVerified = false;
  const stateFor = (fingerprint: string) => {
    automaticFingerprint ??= fingerprint;
    if (fingerprint === automaticFingerprint) return { state: 'AMBIGUOUS', candidates: references, reason: 'comparable-identities', verifiedAt: new Date().toISOString() };
    if (manualPosts === 0) return { state: 'MISS' };
    if (!manualVerified) return { state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() };
    return {
      state: 'VERIFIED', verifiedAt: new Date().toISOString(), nextRefreshAt: new Date(Date.now() + 86_400_000).toISOString(),
      profile: { candidate: { externalId: '123', mediaKind: 'MANHWA', preSerialization: false, provider: 'mangaupdates', titles: [title] }, references: [references[0]], workId: 'work_synthetic_ambiguous' },
    };
  };
  try {
    await context.routeWebSocket('**/*', async (socket) => { forbiddenRequests.push(new URL(socket.url()).origin); await socket.close(); });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') { await route.continue(); return; }
      if (url.origin !== 'https://tobirink.com') { forbiddenRequests.push(url.origin); await route.abort('blockedbyclient'); return; }
      if (url.pathname === '/v3/catalogue/discoveries/lookup' && request.method() === 'POST') {
        const submission = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(submission.keys.map((key: { fingerprint: string }) => ({ key, state: stateFor(key.fingerprint) }))) });
        return;
      }
      if (url.pathname === '/v3/catalogue/discoveries' && request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stateFor(url.searchParams.get('fingerprint')!)) });
        return;
      }
      if (url.pathname === '/v3/catalogue/discoveries/requests' && request.method() === 'POST') {
        const submission = request.postDataJSON();
        expect(submission.query.explicitProviderReference).toEqual(references[0]);
        expect(submission.key.fingerprint).not.toBe(automaticFingerprint);
        expect(submission.query).not.toHaveProperty('url');
        manualPosts += 1;
        await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(stateFor(submission.key.fingerprint)) });
        return;
      }
      await route.fulfill({ status: 404, body: '' });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const bookmark = await worker.evaluate(async (input) => chrome.bookmarks.create(input), { title, url: 'https://manhwaz.com/webtoon/synthetic-ambiguous-river/chapter-7' });
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole('button', { name: /^(Commencer l’analyse|Reprendre maintenant|Vérifier à nouveau)$/u }).click();
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/review.html`);
    const readPrivate = () => page.evaluate(() => new Promise<{ works: unknown[]; reviews: { status: string; decisionOrigin?: string }[]; sources: { resolution?: { kind: string }; bookmarkId?: string }[] }>((resolveState, rejectState) => {
      const opening = indexedDB.open('tobirink-private');
      opening.onerror = () => rejectState(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction(['favoriteSources', 'reviews', 'works'], 'readonly');
        const works = transaction.objectStore('works').getAll();
        const reviews = transaction.objectStore('reviews').getAll();
        const sources = transaction.objectStore('favoriteSources').getAll();
        transaction.oncomplete = () => { database.close(); resolveState({ works: works.result, reviews: reviews.result, sources: sources.result }); };
        transaction.onerror = () => { database.close(); rejectState(transaction.error); };
      };
    }));
    await expect.poll(async () => (await readPrivate()).reviews.length, { timeout: 30_000 }).toBe(1);
    await page.reload();
    await page.getByRole('button', { name: 'Correspondances à vérifier', exact: true }).click();
    const choice = page.getByRole('button', { name: 'Vérifier mangaupdates:123', exact: true });
    await expect(choice).toBeVisible();
    await expect(page.getByRole('button', { name: 'Vérifier mangaupdates:456', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Identités fournisseur à vérifier' }).locator('img')).toHaveCount(0);
    expect((await readPrivate()).works).toEqual([]);
    expect(manualPosts).toBe(0);
    await choice.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => manualPosts).toBe(1);
    await expect(page.getByText('Vérification en cours · réessayez dans quelques instants')).toBeVisible();
    expect(await readPrivate()).toMatchObject({ works: [], reviews: [{ status: 'pending' }], sources: [{ bookmarkId: bookmark.id, resolution: { kind: 'REVIEW_REQUIRED' } }] });
    await expect(choice).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    manualVerified = true;
    expect(await restartInstalledReviewWorker(context, page, extensionId)).toBe(true);
    await choice.click();
    await expect.poll(async () => (await readPrivate()).reviews[0]?.status).toBe('resolved');
    const resolved = await readPrivate();
    expect(resolved.reviews).toMatchObject([{ status: 'resolved', decisionOrigin: 'human' }]);
    expect(resolved.works).toMatchObject([{ externalReferences: [{ provider: 'mangaupdates', externalId: '123' }], preferredTitle: title }]);
    expect(resolved.sources).toMatchObject([{ bookmarkId: bookmark.id, resolution: { kind: 'RESOLVED' } }]);
    await expect(page.getByRole('dialog', { name: 'Correspondances à vérifier', exact: true }).getByRole('heading', { name: 'Aucune correspondance à vérifier', exact: true })).toBeVisible();
    expect(manualPosts).toBe(1);
    expect(forbiddenRequests).toEqual([]);
  } finally {
    await context.close();
  }
});

test('installed site Library sorts the full private catalogue promptly', async () => {
  test.setTimeout(150_000);
  const repository = resolve(import.meta.dirname, '../../..');
  const version = JSON.parse(readFileSync(resolve(repository, 'apps/extension/package.json'), 'utf8')).version;
  const archive = process.env.TOBIRINK_TEST_ARCHIVE ?? resolve(repository, `apps/extension/.output/packages/tobirink-chrome-mv3-${version}.zip`);
  const extensionPath = mkdtempSync(resolve(tmpdir(), 'tobirink-sort-extension-'));
  const profilePath = mkdtempSync(resolve(tmpdir(), 'tobirink-sort-profile-'));
  execFileSync('unzip', ['-q', archive, '-d', extensionPath]);
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: 'chromium', headless: true,
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.evaluate(() => chrome.runtime.sendMessage({ type: 'favorite.reconcile', version: 1 }));
    await expect.poll(async () => optionsPage.evaluate(async () => (await chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 })).inventory?.status)).toBe('complete');
    await optionsPage.close();
    const privateLibrary = await context.newPage();
    await privateLibrary.goto(`chrome-extension://${extensionId}/library.html`);
    await expect(privateLibrary.getByRole('main', { name: 'Bibliothèque' })).toBeVisible();
    await privateLibrary.evaluate(() => new Promise<void>((resolveSeed, rejectSeed) => {
      const opening = indexedDB.open('tobirink-private');
      opening.onerror = () => rejectSeed(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction(['libraries', 'favoriteSources', 'favoriteArtifacts'], 'readwrite');
        Array.from({ length: 1400 }, (_, index) => index).forEach((index) => {
          const sourceId = `source_sort${String(index).padStart(4, '0')}`;
          const title = `Synthetic ${String(index).padStart(4, '0')}`;
          const url = `https://reader.invalid/manga/${index}`;
          transaction.objectStore('favoriteSources').put({ id: sourceId, bookmarkId: `sort-${index}`, folderPath: [], importedAt: '2026-09-19T00:00:00.000Z', order: index, presence: 'observed', resolution: { kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' }, title, url });
          transaction.objectStore('favoriteArtifacts').put({ sourceId, recordedAt: '2026-09-19T00:00:00.000Z', artifact: { contractVersion: 2, diagnostics: [], displayTitle: title, mediaKind: 'MANGA', parserVersion: 'fixture-v1', raw: { title, url }, semanticFingerprint: `fixture-${index}`, sourceAdapterVersion: 'fixture-v1', sourceEvidence: { aliases: [], diagnostics: [], key: `fixture-${index}`, mediaKind: 'MANGA', proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture', strategy: 'exact-origin' }, status: 'parsed', transformations: [] } });
        });
        for (let index = 1400; index < 1532; index += 1) transaction.objectStore('favoriteSources').put({ id: `source_sort${index}`, bookmarkId: `sort-${index}`, folderPath: [], importedAt: '2026-09-19T00:00:00.000Z', order: index, presence: 'observed', resolution: { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' }, title: `Utility ${index}`, url: `https://reader.invalid/search/${index}` });
        transaction.objectStore('libraries').put({ id: 'library_primary', workIds: [] });
        transaction.oncomplete = () => { database.close(); resolveSeed(); };
        transaction.onerror = () => { database.close(); rejectSeed(transaction.error); };
      };
    }));
    const seededCatalogue = await privateLibrary.evaluate(() => chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_ASC' }));
    expect(seededCatalogue.ok, seededCatalogue.error).toBe(true);
    const seededCounts = await privateLibrary.evaluate(() => new Promise<{ artifacts: number; sources: number }>((resolveCounts, rejectCounts) => {
      const opening = indexedDB.open('tobirink-private');
      opening.onerror = () => rejectCounts(opening.error);
      opening.onsuccess = () => {
        const transaction = opening.result.transaction(['favoriteSources', 'favoriteArtifacts'], 'readonly');
        const sources = transaction.objectStore('favoriteSources').count();
        const artifacts = transaction.objectStore('favoriteArtifacts').count();
        transaction.oncomplete = () => resolveCounts({ sources: sources.result, artifacts: artifacts.result });
        transaction.onerror = () => rejectCounts(transaction.error);
      };
    }));
    expect(seededCounts).toEqual({ artifacts: 1400, sources: 1532 });
    expect(seededCatalogue.snapshot.statistics.total).toBe(1400);
    const workerTimings: number[] = [];
    for (const requestedSort of ['TITLE_ASC', 'TITLE_DESC', 'ADDED_DESC', 'TITLE_ASC'] as const) {
      const startedAt = Date.now();
      const catalogue = await privateLibrary.evaluate(async (sort) => chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort }), requestedSort);
      expect(catalogue.ok, catalogue.error).toBe(true);
      expect(catalogue.snapshot.statistics.total).toBe(1400);
      expect(catalogue.snapshot.items[0]?.title).toMatch(/^Synthetic \d{4}$/u);
      workerTimings.push(Date.now() - startedAt);
    }
    process.stdout.write(`Installed extension Library: worker sorts ${workerTimings.join(', ')} ms.\n`);
    expect(Math.max(...workerTimings)).toBeLessThan(45_000);
    const coldStartedAt = Date.now();
    expect(await restartInstalledReviewWorker(context, privateLibrary, extensionId)).toBe(true);
    const coldCatalogue = await privateLibrary.evaluate(async () => chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_DESC' }));
    expect(coldCatalogue.ok, coldCatalogue.error).toBe(true);
    expect(coldCatalogue.snapshot.items[0]?.title).toBe('Synthetic 1399');
    const workerRestartMs = Date.now() - coldStartedAt;
    process.stdout.write(`Installed extension Library: worker restart sort ${workerRestartMs} ms.\n`);
    // A shared CI host can spend several seconds restarting Chromium's
    // extension worker after the cold-target assertion; keep the budget
    // bounded without treating a genuinely stalled bridge as successful.
    expect(workerRestartMs).toBeLessThan(30_000);
  } finally {
    await context.close();
  }
});
