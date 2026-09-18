/* global browser, indexedDB, fetch, AbortSignal */

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { installedAgendaFixture } from './installed-agenda-fixture.mjs';

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
const context = await firefox.launchPersistentContext(profile, { args: ['--marionette', '--remote-allow-system-access'], executablePath, headless: true, firefoxUserPrefs: {
  'marionette.port': port,
  'network.proxy.type': 1,
  'network.proxy.http': '127.0.0.1',
  'network.proxy.http_port': 9,
  'network.proxy.ssl': '127.0.0.1',
  'network.proxy.ssl_port': 9,
  'network.proxy.no_proxies_on': 'localhost, 127.0.0.1',
  'extensions.webextensions.uuids': JSON.stringify({ 'tobirink@tobirink.local': uuid }),
} });
let automation;
try {
  await context.setOffline(true);
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
  await automation.command('WebDriver:SetTimeouts', { pageLoad: 15000, script: 15000 });
  await automation.command('WebDriver:Navigate', { url: `moz-extension://${uuid}/options.html` });
  const extensionPage = {
    async evaluate(callback, argument = null) {
      const result = await automation.command('WebDriver:ExecuteScript', {
        args: [argument], newSandbox: false, script: `return (${callback.toString()})(arguments[0]);`,
      });
      return result.value;
    },
  };
  const health = await extensionPage.evaluate(() => browser.runtime.sendMessage({ type: 'health.check', version: 1 }));
  assert.equal(health.ok, true);
  const networkBlocked = await extensionPage.evaluate(async () => {
    try { await fetch('https://tobirink.com/health', { signal: AbortSignal.timeout(3000) }); return false; }
    catch { return true; }
  });
  assert.equal(networkBlocked, true, 'External network must be blocked before seeding bookmarks.');
  const builtinCount = await extensionPage.evaluate(async () => {
    const count = (nodes) => nodes.reduce((total, node) => total + (node.url ? 1 : 0) + count(node.children ?? []), 0);
    return count(await browser.bookmarks.getTree());
  });
  await extensionPage.evaluate(() => browser.runtime.sendMessage({ sort: 'TITLE_ASC', type: 'library.catalogue.read', version: 1 }));
  const agendaFixture = installedAgendaFixture();
  await extensionPage.evaluate((fixture) => new Promise((resolve, reject) => {
    const opening = indexedDB.open('tobirink-private');
    opening.onerror = () => reject(new Error('Agenda database unavailable.'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(['works', 'publicReleaseEvents', 'publicReleaseSyncState', 'localAgendaProjectionState'], 'readwrite');
      transaction.objectStore('localAgendaProjectionState').clear();
      fixture.works.forEach((work) => transaction.objectStore('works').put(work));
      fixture.events.forEach((event) => transaction.objectStore('publicReleaseEvents').put(event));
      transaction.objectStore('publicReleaseSyncState').put(fixture.active);
      transaction.oncomplete = () => { database.close(); resolve(true); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Agenda seed failed.')); };
    };
  }), agendaFixture);
  const agenda = await extensionPage.evaluate((period) => browser.runtime.sendMessage({ ...period, type: 'agenda.period.read', version: 1 }), agendaFixture.period);
  assert.equal(agenda.ok, true, JSON.stringify(agenda));
  assert.ok(agenda.snapshot.items.some((item) => item.mediaType === 'anime' && item.occursAt === agendaFixture.events[0].occurrence.value));
  assert.ok(agenda.snapshot.items.some((item) => item.mediaType === 'manga' && item.occursOn === agendaFixture.events[1].occurrence.value));
  const bookmark = await extensionPage.evaluate(() => browser.bookmarks.create({ title: 'Synthetic ordinary video', url: 'https://www.youtube.com/watch?v=synthetic' }));
  let unsupported = false;
  for (let attempt = 0; attempt < 75 && !unsupported; attempt += 1) {
    const status = await extensionPage.evaluate((bookmarkId) => new Promise((resolve, reject) => {
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
    }), bookmark.id);
    unsupported = status === 'UNSUPPORTED';
    if (!unsupported) await wait(200);
  }
  assert.equal(unsupported, true);
  const queue = await extensionPage.evaluate(() => browser.runtime.sendMessage({ type: 'review.queue.read', version: 1 }));
  assert.deepEqual(queue, { ok: true, snapshot: { items: [], status: 'pending' } });
  const count = await extensionPage.evaluate(() => new Promise((resolve, reject) => {
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
  }));
  assert.equal(count, 0);
  await automation.command('WebDriver:SetTimeouts', { pageLoad: 15000, script: 60000 });
  await extensionPage.evaluate(async () => {
    for (let index = 0; index < 1400; index += 1) {
      await browser.bookmarks.create({ title: `Synthetic corpus ${index}`, url: `https://reader.invalid/manga/synthetic-corpus-${index}/42` });
    }
    for (let index = 0; index < 131; index += 1) {
      await browser.bookmarks.create({ title: `Synthetic utility ${index}`, url: `https://reader.invalid/search/synthetic-${index}` });
    }
  });
  await extensionPage.evaluate(() => browser.runtime.sendMessage({ type: 'favorite.reconcile', version: 1 }));
  let status;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    status = await extensionPage.evaluate(() => browser.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
    if (status.ok && status.counts.observed === 1532 + builtinCount && status.counts.processing === 0 && status.inventory.status === 'complete') break;
    await extensionPage.evaluate(() => browser.runtime.sendMessage({ type: 'favorite.reconcile', version: 1 }));
    await wait(250);
  }
  assert.equal(status?.ok, true);
  assert.equal(status.counts.observed, 1532 + builtinCount);
  assert.ok(status.counts.unsupported >= 132);
  assert.ok(status.counts.retryable >= 1400);
  assert.equal(status.counts.retryable + status.counts.unsupported, 1532 + builtinCount);
  assert.equal(status.counts.resolved, 0);
  assert.equal(status.counts.blocked, 0);
  assert.equal(status.counts.publicDiscoveryPending ?? 0, 0);
  process.stdout.write(`Installed Firefox offline corpus: ${JSON.stringify(status.counts)}\n`);
  process.stdout.write('Installed Firefox: health, anime INSTANT and manga DATE Agenda reconstruction, ordinary bookmark exclusion, empty queue and zero imported Review passed.\n');
} finally {
  automation?.close();
  await context.close();
}
