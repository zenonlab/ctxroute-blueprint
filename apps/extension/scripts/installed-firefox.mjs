import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

async function connectMarionette(port) {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setTimeout(15000, () => socket.destroy(new Error('Firefox automation timed out.')));
  const reader = socket[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  let sequence = 0;
  async function receive() {
    for (;;) {
      const colon = buffer.indexOf(58);
      if (colon >= 0) {
        const length = Number(buffer.subarray(0, colon).toString());
        if (!Number.isSafeInteger(length) || length < 1 || length > 1048576) throw new Error('Invalid Firefox automation frame.');
        if (buffer.length >= colon + 1 + length) {
          const frame = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
          buffer = buffer.subarray(colon + 1 + length);
          return frame;
        }
      }
      const chunk = await reader.next();
      if (chunk.done) throw new Error('Firefox automation closed.');
      buffer = Buffer.concat([buffer, chunk.value]);
      if (buffer.length > 1048592) throw new Error('Firefox automation exceeded its frame budget.');
    }
  }
  const greeting = await receive();
  assert.equal(greeting.marionetteProtocol, 3);
  return {
    close: () => socket.destroy(),
    async command(name, parameters) {
      sequence += 1;
      const payload = JSON.stringify([0, sequence, name, parameters]);
      socket.write(`${Buffer.byteLength(payload)}:${payload}`);
      const response = await receive();
      assert.equal(response[0], 1);
      assert.equal(response[1], sequence);
      if (response[2] !== null) throw new Error(JSON.stringify(response[2]));
      return response[3];
    },
  };
}

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { firefox } = require('@playwright/test');
const executablePath = process.env.FIREFOX_BIN;
if (!executablePath) throw new Error('FIREFOX_BIN must select an installed Firefox test executable.');
const archive = process.argv[2];
if (!archive) throw new Error('Provide the local Firefox candidate ZIP.');
const bytes = await readFile(archive);
const profile = await mkdtemp(join(tmpdir(), 'tobirink-firefox-installed-'));
const reservation = createServer();
await new Promise((ready) => { reservation.listen(0, '127.0.0.1', ready); });
const { port } = reservation.address();
await new Promise((ready) => { reservation.close(ready); });
const uuid = randomUUID();
await writeFile(join(profile, 'user.js'), `user_pref("marionette.port", ${port});\n`, { flag: 'wx' });
const context = await firefox.launchPersistentContext(profile, { args: ['--marionette'], executablePath, headless: true, firefoxUserPrefs: {
  'marionette.port': port,
  'extensions.webextensions.uuids': JSON.stringify({ 'tobirink@tobirink.local': uuid }),
} });
let automation;
try {
  process.stdout.write(`Firefox ${context.browser().version()}, archive SHA-256 ${createHash('sha256').update(bytes).digest('hex')}\n`);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      automation = await connectMarionette(port);
      break;
    } catch (error) {
      if (error.code !== 'ECONNREFUSED' || attempt === 24) throw error;
      await wait(200);
    }
  }
  await automation.command('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
  await automation.command('Addon:Install', { path: resolve(archive), temporary: true });
  await automation.command('WebDriver:Navigate', { url: `moz-extension://${uuid}/options.html` });
  const health = await automation.command('WebDriver:ExecuteScript', { args: [], newSandbox: false, script: 'return browser.runtime.sendMessage({ type: "health.check", version: 1 });' });
  assert.equal(health.value.ok, true);
  const bookmark = await automation.command('WebDriver:ExecuteScript', { args: [{ title: 'Synthetic ordinary video', url: 'https://www.youtube.com/watch?v=synthetic' }], newSandbox: false, script: 'return browser.bookmarks.create(arguments[0]);' });
  let unsupported = false;
  for (let attempt = 0; attempt < 75 && !unsupported; attempt += 1) {
    const status = await automation.command('WebDriver:ExecuteScript', { args: [bookmark.value.id], newSandbox: false, script: `const bookmarkId = arguments[0]; return new Promise((resolve, reject) => {
      const opening = indexedDB.open('tobirink-private');
      opening.onerror = () => reject(new Error('Private database unavailable.'));
      opening.onsuccess = () => {
        const database = opening.result;
        const transaction = database.transaction('favoriteSources', 'readonly');
        const request = transaction.objectStore('favoriteSources').index('bookmarkId').get(bookmarkId);
        request.onsuccess = () => resolve(request.result?.resolution?.kind ?? null);
        request.onerror = () => reject(new Error('Source unavailable.'));
        transaction.oncomplete = () => database.close();
      };
    });` });
    unsupported = status.value === 'UNSUPPORTED';
    if (!unsupported) await wait(200);
  }
  assert.equal(unsupported, true);
  const queue = await automation.command('WebDriver:ExecuteScript', { args: [], newSandbox: false, script: 'return browser.runtime.sendMessage({ type: "review.queue.read", version: 1 });' });
  assert.deepEqual(queue.value, { ok: true, snapshot: { items: [], status: 'pending' } });
  const count = await automation.command('WebDriver:ExecuteScript', { args: [], newSandbox: false, script: `return new Promise((resolve, reject) => {
    const opening = indexedDB.open('tobirink-private');
    opening.onerror = () => reject(new Error('Private database unavailable.'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction('reviews', 'readonly');
      const request = transaction.objectStore('reviews').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Review count unavailable.'));
      transaction.oncomplete = () => database.close();
    };
  });` });
  assert.equal(count.value, 0);
  process.stdout.write('Installed Firefox: health, ordinary bookmark excluded, empty queue and zero imported Review passed.\n');
} finally {
  automation?.close();
  await context.close();
}
