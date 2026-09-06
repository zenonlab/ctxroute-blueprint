import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface BridgeFixture {
  agenda: Array<{ availability: 'confirmed' | 'estimated' | 'official'; kind: 'anime' | 'manga'; releaseLabel: string; title: string; workId: string }>;
  library: Array<{ mediaKind: 'anime' | 'manga'; progressLabel?: string; title: string; workId: string }>;
}

declare global {
  interface Window { __agendaReads?: number; __libraryReads?: number }
}

const fixture: BridgeFixture = {
  agenda: [
    { availability: 'official', kind: 'anime', releaseLabel: 'Épisode 8', title: 'Œuvre Alpha', workId: 'work_alpha' },
    { availability: 'estimated', kind: 'manga', releaseLabel: 'Chapitre 12', title: 'Œuvre Bêta', workId: 'work_beta' },
  ],
  library: [
    { mediaKind: 'anime', progressLabel: 'Épisode 7/12', title: 'Œuvre Alpha', workId: 'work_alpha' },
    { mediaKind: 'manga', progressLabel: 'Chapitre 11', title: 'Œuvre Bêta', workId: 'work_beta' },
    { mediaKind: 'anime', title: 'Œuvre Gamma', workId: 'work_gamma' },
    { mediaKind: 'manga', title: 'Œuvre Delta', workId: 'work_delta' },
  ],
};

async function installBridge(page: Page, selectedFixture: BridgeFixture = fixture) {
  await page.addInitScript((bridgeFixture: BridgeFixture) => {
    window.__agendaReads = 0;
    window.__libraryReads = 0;
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'webbridge.handshake') {
        const response = { expiresAt: Date.now() + 60_000, nonce: 'test_session_nonce', ok: true, protocolVersion: 2, requestId: message.requestId, type: 'tobirink.webbridge.response' };
        window.postMessage({ requestId: message.requestId, response, type: 'tobirink.webbridge.response' }, window.location.origin);
        return;
      }
      const request = message?.request;
      if (!request?.requestId) return;
      let value;
      if (request.type === 'bootstrap.read') value = { availability: 'connected', generation: 1, libraryCount: bridgeFixture.library.length, pendingReviewCount: 0, protocolVersion: 2 };
      if (request.type === 'review.read') value = { candidates: [], context: 'local' };
      if (request.type === 'library.read') {
        window.__libraryReads = (window.__libraryReads ?? 0) + 1;
        value = { hasMore: false, items: bridgeFixture.library.filter((item) => request.query.facet === 'all' || item.mediaKind === request.query.facet).slice(0, request.query.limit), query: request.query };
      }
      if (request.type === 'agenda.read') {
        window.__agendaReads = (window.__agendaReads ?? 0) + 1;
        value = { entries: bridgeFixture.agenda.map((entry, index) => ({ ...entry, occursAt: `${request.from}T${index === 0 ? '18:30:00+02:00' : '20:00:00+02:00'}` })), from: request.from, to: request.to };
      }
      if (value) window.postMessage({ requestId: request.requestId, response: { ok: true, requestId: request.requestId, type: 'tobirink.webbridge.response', value }, type: 'tobirink.webbridge.response' }, window.location.origin);
    });
  }, selectedFixture);
}

test('desktop Workbench renders real bridge projections and navigation', async ({ page }) => {
  await installBridge(page);
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '4 œuvres' })).toBeVisible();
  await expect(page.locator('a[data-variant="library"]')).toHaveCount(4);
  await expect(page.locator('a[data-variant="library"]').first()).toHaveCSS('width', '196px');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(9, 9, 11)');
  expect(await page.locator('header img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test('Library keeps filters in the URL and remains bounded on mobile', async ({ page }) => {
  await installBridge(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/library?search=%C5%93uvre&facet=anime');
  await expect(page.getByRole('main', { name: 'Bibliothèque' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__libraryReads)).toBe(1);
  await expect(page.getByLabel('Rechercher dans la bibliothèque')).toHaveValue('œuvre');
  await expect(page.locator('a[data-variant="library"]')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
});

test('connected empty Library matches the Workbench empty surface', async ({ page }) => {
  await installBridge(page, { agenda: [], library: [] });
  await page.goto('/library');
  await expect(page.getByRole('main', { name: 'Bibliothèque' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Votre bibliothèque est vide' })).toBeVisible();
  await expect(page.getByText('Importez vos favoris ou ajoutez une première œuvre.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Télécharger l’extension' })).toBeVisible();
  await expect(page.locator('[data-layout="centered"] > span svg')).toHaveCSS('width', '48px');
  await expect(page.locator('[data-variant="library"]')).toHaveCount(1);
  await expect(page.locator('h2').filter({ hasText: 'Votre bibliothèque est vide' })).toHaveCSS('font-size', '18px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Agenda keeps seven horizontal days and emits one read per week', async ({ page }) => {
  await installBridge(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/agenda');
  await expect(page.getByRole('heading', { exact: true, name: 'Agenda' })).toBeVisible();
  await expect(page.locator('[aria-label^="Agenda ·"] > section')).toHaveCount(7);
  await expect.poll(() => page.evaluate(() => window.__agendaReads)).toBe(1);
  await page.getByRole('button', { name: 'Semaine suivante' }).click();
  await expect.poll(() => page.evaluate(() => window.__agendaReads)).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('missing extension exposes no private cards while verified downloads stay public', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByText(/Extension absente/u)).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('a[data-variant="library"]')).toHaveCount(0);
  await expect(page.locator('[data-layout="centered"] > span svg')).toHaveCSS('width', '48px');
  await page.goto('/download');
  await expect(page.getByRole('heading', { name: 'Choisir votre navigateur' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Installer, puis importer.' })).toHaveCSS('font-size', '32px');
  await expect(page.getByRole('link', { name: /Télécharger pour Chrome|Télécharger pour Firefox/u })).toHaveCount(2);
  await expect(page.locator('[data-variant="outlined"]')).toHaveCount(2);
  await expect(page.locator('.download-link svg')).toHaveCount(2);
  await page.goto('/privacy');
  await expect(page.locator('[data-variant="outlined"]')).toHaveCount(3);
  for (const route of ['/', '/library', '/agenda', '/privacy', '/download']) {
    expect((await request.get(route)).status(), route).toBe(200);
  }
  expect((await request.get('/route-inconnue')).status()).toBe(404);
});
