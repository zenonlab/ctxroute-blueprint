import { expect, test, chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';

declare const chrome: any;

test('Wave 7 extension popup renders linked episode progression', async ({ isMobile, browserName }) => {
  test.skip(isMobile || browserName !== 'chromium', 'extension popup is covered by the Chromium MV3 project');
  const extensionPath = resolve(process.cwd(), '../extension/.output/chrome-mv3');
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 720 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    await context.route('https://favlib.home.arpa/episode/12', route => route.fulfill({ status:200,contentType:'text/html',body:'<!doctype html><title>Episode 12</title><h1>Episode 12</h1>' }));
    const tab = await context.newPage();
    await tab.goto('https://favlib.home.arpa/episode/12');
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.locator('#connection')).toContainText('Non lié');

    await context.route('https://favlib.home.arpa/api/v1/extension/page-resolution*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state:'known',media:{id:'orbital-knights-s1',title:'Orbital Knights',type:'ANIME'},progress:{raw:'11'} }) }));
    await context.route('https://favlib.home.arpa/api/v1/extension/favorites*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({items:[]}) }));
    const episodeUrl = 'https://favlib.home.arpa/episode/12';
    await popup.evaluate((url) => { const bookmark={ id:'b1',parentId:null,title:'Episode 12',url,dateAdded:null,dateGroupModified:null,fingerprint:'a'.repeat(64) };return chrome.storage.local.set({ favlibState:{version:4,installationId:'e2e-extension',deviceToken:'e2e-device',queue:[],cursor:null,lastSyncAt:Date.now(),sites:[],checks:[],autoUpdateFavorites:false,observeNavigation:false,updates:[],knownBookmarks:[bookmark],inventory:{totalWeb:1,likelyMedia:1,ambiguous:0,digest:'b'.repeat(64),updatedAt:Date.now()},syncStatus:'verified',serverReceipt:{inventoryTotal:1,recognizedCount:1,reviewCount:0,excludedCount:0,inventoryDigest:'b'.repeat(64),serverSyncedAt:Date.now(),attemptedAt:Date.now(),verifiedAt:Date.now()}} }) }, episodeUrl);
    await popup.addInitScript(url => { chrome.tabs.query = async () => [{ url }]; }, episodeUrl);
    await popup.reload();
    await expect(popup.locator('#connection')).toContainText('Automatique');
    await expect(popup.locator('.tab.active')).toContainText('Page');
    await tab.bringToFront();
    await expect(popup.locator('#page-content')).toContainText('Orbital Knights');
    await expect(popup.locator('#page-content')).toContainText('11');
    await popup.locator('[data-panel="1"]').click();
    await expect(popup.locator('.tab.active')).toContainText('Liste');
    await expect(popup.locator('#pairing')).toBeHidden();
    await expect(popup.getByText('Synchroniser maintenant')).toHaveCount(0);
    const accessibility=await new AxeBuilder({page:popup}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
    expect(accessibility.violations,accessibility.violations.map(violation=>`${violation.id} (${violation.nodes.length})`).join(', ')).toEqual([]);
  } finally {
    await context.close();
  }
});
