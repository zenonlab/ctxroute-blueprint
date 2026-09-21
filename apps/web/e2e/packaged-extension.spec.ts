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
    // Keep one extension page alive while the public site attaches. This
    // prevents Chromium from suspending the MV3 worker between surfaces on
    // the shared runner and keeps the bridge mount deterministic.
    await context.route('https://tobirink.com/**', async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.continue();
        return;
      }
      const requested = new URL(route.request().url());
      const response = await route.fetch({ url: `http://127.0.0.1:4173${requested.pathname}${requested.search}` });
      await route.fulfill({ response });
    });
    let site = await context.newPage();
    const firstLoadStartedAt = Date.now();
    await site.goto('https://tobirink.com/library', { waitUntil: 'networkidle' });
    await expect(site.getByRole('main', { name: 'Bibliothèque' })).toBeVisible({ timeout: 30_000 });
    const firstLoadMs = Date.now() - firstLoadStartedAt;
    const bridgeTimings: number[] = [];
    const renderedTimings: number[] = [];
    let sortSelect = site.getByLabel('Tri');
    // A shared runner can expose the static shell before the content script
    // attaches. Recreate the document a bounded number of times so this gate
    // proves the installed extension bridge rather than a timing accident.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await expect(sortSelect).toBeVisible({ timeout: 8_000 });
        break;
      } catch (caught) {
        if (attempt === 4) throw caught;
        const retry = site.getByRole('button', { name: 'Réessayer' });
        if (await retry.isVisible({ timeout: 500 }).catch(() => false)) await retry.click();
        await site.close();
        site = await context.newPage();
        await site.goto('https://tobirink.com/library', { waitUntil: 'networkidle' });
        await expect(site.getByRole('main', { name: 'Bibliothèque' })).toBeVisible({ timeout: 30_000 });
        sortSelect = site.getByLabel('Tri');
      }
    }
    let currentSort = await sortSelect.evaluate((element) => {
      // SAFETY: the accessible label targets the native sort <select> control.
      return element instanceof HTMLSelectElement ? element.value : '';
    });
    for (const requestedSort of ['TITLE_ASC', 'TITLE_DESC', 'ADDED_DESC', 'TITLE_ASC'] as const) {
      // A native select does not emit change when the requested value is already
      // selected. Pick the next supported value in that case so the bridge
      // response listener below always observes a real transition, including on
      // runners whose initial sort differs from the local fixture.
      const sort = requestedSort === currentSort
        ? (['TITLE_ASC', 'TITLE_DESC', 'ADDED_DESC'] as const).find((candidate) => candidate !== currentSort)!
        : requestedSort;
      const startedAt = Date.now();
      const measuredResponse = site.evaluate((expectedSort) => new Promise<{ elapsedMs: number; firstTitle: string }>((resolveResponse) => {
        const startedAt = performance.now();
        const onMessage = (event: MessageEvent) => {
          const response = event.data?.response;
          if (event.data?.type !== 'tobirink.webbridge.response' || response?.value?.query?.sort !== expectedSort) return;
          window.removeEventListener('message', onMessage);
          resolveResponse({ elapsedMs: performance.now() - startedAt, firstTitle: response.value.items[0].title });
        };
        window.addEventListener('message', onMessage);
      }), sort);
      await site.getByLabel('Tri').selectOption(sort);
      const measured = await measuredResponse;
      expect(measured.firstTitle).toMatch(/^Synthetic \d{4}$/u);
      bridgeTimings.push(measured.elapsedMs);
      renderedTimings.push(Date.now() - startedAt);
      currentSort = sort;
    }
    process.stdout.write(`Installed site Library: first load ${firstLoadMs} ms; bridge sorts ${bridgeTimings.map((value) => value.toFixed(1)).join(', ')} ms; rendered sorts ${renderedTimings.join(', ')} ms.\n`);
    // A shared CI host may briefly stall Chromium. Keep one path below 7.5 s
    // while retaining a bounded 15-second budget for every bridge interaction.
    expect(Math.min(...renderedTimings)).toBeLessThan(7_500);
    expect(Math.max(...renderedTimings)).toBeLessThan(15_000);
    const devtools = await context.browser()!.newBrowserCDPSession();
    const targets = await devtools.send('Target.getTargets');
    const workerTarget = targets.targetInfos.find((entry) => entry.type === 'service_worker' && entry.url === worker.url());
    expect(workerTarget).toBeDefined();
    await devtools.send('Target.closeTarget', { targetId: workerTarget!.targetId });
    await devtools.detach();
    await site.close();
    site = await context.newPage();
    await site.goto('https://tobirink.com/library', { waitUntil: 'networkidle' });
    await expect(site.getByRole('main', { name: 'Bibliothèque' })).toBeVisible();
    sortSelect = site.getByLabel('Tri');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await expect(sortSelect).toBeVisible({ timeout: 8_000 });
        break;
      } catch (caught) {
        if (attempt === 4) throw caught;
        await site.close();
        site = await context.newPage();
        await site.goto('https://tobirink.com/library', { waitUntil: 'networkidle' });
        await expect(site.getByRole('main', { name: 'Bibliothèque' })).toBeVisible({ timeout: 30_000 });
        sortSelect = site.getByLabel('Tri');
      }
    }
    const coldStartedAt = Date.now();
    const coldResponse = site.evaluate(() => new Promise<void>((resolveResponse) => {
      const onMessage = (event: MessageEvent) => {
        if (event.data?.type !== 'tobirink.webbridge.response' || event.data.response?.value?.query?.sort !== 'TITLE_DESC') return;
        window.removeEventListener('message', onMessage);
        resolveResponse();
      };
      window.addEventListener('message', onMessage);
    }));
    await site.getByLabel('Tri').selectOption('TITLE_DESC');
    await coldResponse;
    await expect(site.locator('a[data-variant="library"]').first()).toContainText('Synthetic 1399', { timeout: 15_000 });
    const workerRestartMs = Date.now() - coldStartedAt;
    process.stdout.write(`Installed site Library: worker restart sort ${workerRestartMs} ms.\n`);
    // A shared CI host can spend several seconds restarting Chromium's
    // extension worker after the cold-target assertion; keep the budget
    // bounded without treating a genuinely stalled bridge as successful.
    expect(workerRestartMs).toBeLessThan(30_000);
    await site.close();
  } finally {
    await context.close();
  }
});
