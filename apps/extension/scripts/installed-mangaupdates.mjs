import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const extensionPath = fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'tobirink-mangaupdates-transport-'));
const context = await chromium.launchPersistentContext(profile, {
  args: ['--enable-unsafe-extension-debugging'],
  ignoreDefaultArgs: ['--disable-extensions'],
  channel: 'chromium', headless: true,
});

try {
  const debugging = await context.browser().newBrowserCDPSession();
  const { id } = await debugging.send('Extensions.loadUnpacked', { path: extensionPath });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  const result = await page.evaluate(async () => {
    const rules = globalThis.chrome.declarativeNetRequest;
    const request = async () => {
      const response = await globalThis.fetch('https://api.mangaupdates.com/v1/series/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        body: JSON.stringify({ search: 'Berserk', page: 1, perpage: 25 }),
        signal: globalThis.AbortSignal.timeout(15000),
      });
      const data = response.ok ? await response.json() : undefined;
      return { status: response.status, count: data?.results?.length ?? 0 };
    };
    if (!(await rules.getEnabledRulesets()).includes('mangaupdates_transport')) throw new Error('Packaged transport rule is not enabled');
    await rules.updateEnabledRulesets({ disableRulesetIds: ['mangaupdates_transport'] });
    const before = await request();
    await new Promise(resolve => { setTimeout(resolve, 3100); });
    await rules.updateEnabledRulesets({ enableRulesetIds: ['mangaupdates_transport'] });
    const after = await request();
    return { before, after };
  });
  assert.equal(result.before.status, 403);
  assert.equal(result.after.status, 200);
  assert.ok(result.after.count > 0);
  process.stdout.write(`Installed Chromium ${context.browser()?.version()}: MangaUpdates without rule=${result.before.status}, with rule=${result.after.status}, candidates=${result.after.count}.\n`);
} finally {
  await context.close();
}
