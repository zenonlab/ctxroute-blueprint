import { expect, test, type Page, type Route } from '@playwright/test';

const password = 'FavLib-E2E-Password-2026!';
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function publicApi(page: Page) {
  await page.route('**/api/v1/releases', route => json(route, { items: [] }));
  await page.route('**/api/v1/calendar', route => json(route, { items: [] }));
}

test('public home and calendar are accessible without a session', async ({ page }) => {
  await publicApi(page);
  await page.route('**/api/v1/library*', route => json(route, {}, 401));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Votre bibliothèque' })).toBeVisible();
  await expect(page.getByText('Connexion requise')).toHaveCount(2);
  await page.goto('/calendar');
  await expect(page.getByRole('heading', { name: 'Calendrier' })).toBeVisible();
});

test('authenticated home renders the personal shelf instead of a login gate', async ({ page }) => {
  await publicApi(page);
  await page.route('**/api/v1/library*', route => json(route, { items: [{ id: 'personal-work', title: 'Œuvre personnelle', type: 'MANGA', favoriteCount: 1, coverUrl: '' }], total: 1, nextOffset: 1, hasMore: false }));
  await page.goto('/');
  await expect(page.getByTestId('personal-shelf').getByText('Œuvre personnelle')).toBeVisible();
  await expect(page.getByText('Connexion requise')).not.toBeVisible();
});

test('library and settings protect personal data', async ({ page }) => {
  await page.route('**/api/v1/library*', route => json(route, {}, 401));
  await page.route('**/api/v1/auth/session', route => json(route, {}, 401));
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible();
  await expect(page.getByText('Connexion requise')).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByText('Session requise.')).toBeVisible();
  const loginLink = page.getByRole('link', { name: 'Se connecter' });
  await expect(loginLink).toHaveAttribute('href', /\/login/);
  await expect(loginLink).toHaveCSS('display', 'block');
  await expect(loginLink).toHaveCSS('margin-top', '16px');
});

test('library appends five rows at a time without repeating cards', async ({ page }) => {
  const allItems = Array.from({ length: 65 }, (_, index) => ({
    id: `work-${String(index + 1).padStart(3, '0')}`,
    title: `Œuvre ${String(index + 1).padStart(3, '0')}`,
    type: 'MANGA',
    favoriteCount: 1,
    coverUrl: `/covers/work-${index + 1}.webp`,
  }));
  const requestedOffsets: number[] = [];
  await page.route('**/api/v1/library*', route => {
    const url = new URL(route.request().url());
    if(url.pathname.endsWith('/facets'))return json(route, { types: [{ value: 'MANGA', count: 65 }], themes: [], statuses: [], years: [], providers: [], formats: [], languages: [], contentRatings: [], demographics: [] });
    const limit = Number(url.searchParams.get('limit'));
    const offset = Number(url.searchParams.get('offset'));
    requestedOffsets.push(offset);
    const items = allItems.slice(offset, offset + limit);
    return json(route, { items, total: allItems.length, nextOffset: offset + items.length, hasMore: offset + items.length < allItems.length });
  });
  await page.route('**/covers/*.webp', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') }));

  await page.goto('/library');
  const cards = page.locator('[data-testid="library-grid"] .media-card');
  await expect(cards).toHaveCount(30);
  await expect(cards.first().locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(cards.first().locator('img')).toHaveAttribute('fetchpriority', 'low');

  await page.getByRole('button', { name: 'Voir plus' }).click();
  await expect(cards).toHaveCount(60);
  await page.getByRole('button', { name: 'Voir plus' }).click();
  await expect(cards).toHaveCount(65);
  await expect(page.getByRole('button', { name: 'Voir plus' })).toHaveCount(0);

  const hrefs = await cards.locator('a[aria-label^="Aperçu de"]').evaluateAll(links => links.map(link => link.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(65);
  expect(requestedOffsets).toEqual([0, 30, 60]);
});

test('library combines repeated filters, updates dynamic facets and hides provider controls', async ({ page }) => {
  const resultQueries:string[]=[];
  await page.route('**/api/v1/library/facets*',route=>{
    const url=new URL(route.request().url());
    const anime=url.searchParams.getAll('type').includes('ANIME');
    return json(route,{types:[{value:'ANIME',count:1},{value:'MANGA',count:2}],themes:[{value:'Action',count:anime?1:3},{value:'Drama',count:anime?0:1}],statuses:[],years:[],formats:[],languages:[],contentRatings:[],demographics:[]});
  });
  await page.route('**/api/v1/library*',route=>{
    const url=new URL(route.request().url());
    resultQueries.push(url.search);return json(route,{items:[{id:'filtered',title:'Résultat',type:'ANIME',favoriteCount:1,coverUrl:null}],total:1,nextOffset:1,hasMore:false});
  });
  await page.goto('/library');await expect(page.getByText('Résultat')).toBeVisible();
  await expect(page.getByLabel('Filtrer par fournisseur')).toHaveCount(0);
  await page.getByLabel('Filtrer par types').click();
  await page.locator('.facet-menu label').filter({hasText:'ANIME'}).locator('input').check();
  await page.locator('.facet-menu label').filter({hasText:'MANGA'}).locator('input').check();
  await expect(page).toHaveURL(/type=ANIME.*type=MANGA/);
  await page.getByLabel('Filtrer par thèmes').click();
  await expect(page.locator('.facet-menu label').filter({hasText:'Drama'})).toHaveCount(0);
  await page.locator('.facet-menu label').filter({hasText:'Action'}).locator('input').check();
  await expect(page).toHaveURL(/theme=Action/);
  await expect.poll(()=>resultQueries.at(-1)??'').toContain('theme=Action');
  expect(resultQueries.at(-1)).toContain('type=MANGA');expect(resultQueries.at(-1)).toContain('theme=Action');expect(resultQueries.at(-1)).toContain('offset=0');
});

test('register and login redirect to the extension settings anchor', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.route('**/api/v1/auth/register', route => json(route, {}, 201));
  await page.route('**/api/v1/auth/login', route => json(route, { csrfToken: 'e2e-csrf', user: { email } }));
  await page.route('**/api/v1/auth/session', route => json(route, { user: { email } }));
  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/login\?email=/);
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Email')).toHaveValue(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/settings#extension$/);
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
});

test('authenticated pairing confirms and survives refresh', async ({ page }) => {
  const email = `pair-${Date.now()}@example.test`;
  const body = { challengeId: 'e2e-challenge', code: '12345678' };
  await page.route('**/api/v1/auth/session', route => json(route, { user: { email } }));
  await page.route('**/api/v1/extension/devices', route => json(route, { items: [] }));
  let submittedCode = '';
  await page.route('**/api/v1/extension/pairing/challenges/e2e-challenge/confirm', async route => { submittedCode = (await route.request().postDataJSON()).code; await json(route, { ok: true }); });
  await page.goto(`/settings?pairing=${body.challengeId}#extension&code=${body.code}`);
  await expect(page.getByText('Extension liée. L’import reprend automatiquement dans le popup.')).toBeVisible();
  expect(submittedCode).toBe(body.code);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
});

test('mobile exposes the real bottom navigation', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');
  await page.goto('/');
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.locator('.mobile-nav').getByText('Bibliothèque').click();
  await expect(page.getByRole('heading', { name: 'Bibliothèque' })).toBeVisible();
});
