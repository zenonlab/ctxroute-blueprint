import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const archive = process.env.TOBIRINK_TEST_ARCHIVE;

test('published Chrome extension reaches the public Discovery API', async () => {
  test.setTimeout(90_000);
  test.skip(!archive, 'Set TOBIRINK_TEST_ARCHIVE to the immutable public Chrome ZIP.');
  const extensionPath = mkdtempSync(resolve(tmpdir(), 'tobirink-public-extension-'));
  const profilePath = mkdtempSync(resolve(tmpdir(), 'tobirink-public-profile-'));
  execFileSync('unzip', ['-q', archive!, '-d', extensionPath]);
  const context = await chromium.launchPersistentContext(profilePath, {
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    channel: 'chromium',
    headless: true,
  });
  try {
    let admissions = 0;
    // A real synthetic bookmark may trigger admission; never let its POST
    // mutate production. The GET/lookup path still reaches the live API.
    await context.route('https://tobirink.com/v3/catalogue/discoveries/requests', async (route) => {
      admissions += 1;
      await route.fulfill({
        body: JSON.stringify({ retryAt: new Date(Date.now() + 60_000).toISOString(), state: 'PENDING' }),
        contentType: 'application/json', status: 202,
      });
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const result = await worker.evaluate(async () => {
      try {
        const response = await fetch('https://tobirink.com/v3/catalogue/discoveries?fingerprint=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&mediaKind=ANIME&parserVersion=synthetic&siteRulesVersion=synthetic', {
          cache: 'no-store', credentials: 'omit', method: 'GET', redirect: 'error',
        });
        return { state: (await response.json()).state, status: response.status };
      } catch (error) {
        return { error: error instanceof Error ? error.name : 'unknown' };
      }
    });
    // A synthetic, valid key reads D1 without creating a discovery request.
    expect(result).toEqual({ state: 'MISS', status: 200 });
    await worker.evaluate(async () => {
      await chrome.bookmarks.create({ title: 'Synthetic Anime Canary', url: 'https://anilist.co/anime/999999999/synthetic-anime-canary' });
    });
    const extensionId = new URL(worker.url()).host;
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByRole('button', { name: /^(Commencer l’analyse|Reprendre maintenant|Vérifier à nouveau)$/u }).click();
    await expect.poll(() => admissions, { timeout: 60_000 }).toBe(1);
  } finally {
    await context.close();
  }
});
