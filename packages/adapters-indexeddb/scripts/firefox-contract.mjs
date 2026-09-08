import { firefox } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const executablePath = process.env.FIREFOX_BIN;
if (!executablePath) throw new Error('FIREFOX_BIN must select an already installed Firefox test executable.');
const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const endpoint = server.resolvedUrls.local[0];
let browser;
try {
  browser = await firefox.launch({ headless: true, executablePath });
  process.stdout.write(`Firefox ${browser.version()}\n`);
  for (const path of ['test/index.html', 'test/migrations.html', 'test/tasks.html']) {
    const page = await browser.newPage();
    await page.goto(endpoint + path);
    await page.waitForFunction(() => ['passed', 'failed'].includes(globalThis.document.body.dataset.status), { timeout: 30000 });
    const status = await page.locator('body').getAttribute('data-status');
    if (status !== 'passed') throw new Error(await page.locator('body').innerText());
    process.stdout.write(`${path}: ${status}\n`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
