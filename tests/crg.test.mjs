import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCrgUpdate } from '../scripts/crg-runner.mjs';
import { createCrgWatcher } from '../scripts/watch-crg.mjs';

test('CRG runner uses a bounded ephemeral child and records SQLite WAL state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'crg-runner-'));
  const databasePath = join(directory, 'state.sqlite');
  const result = await runCrgUpdate({ cwd: directory, databasePath, executable: process.execPath, args: ['-e', 'process.stdout.write("ok")'] });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'ok');
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(databasePath);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db.prepare('SELECT count(*) AS count FROM crg_updates').get().count, 1);
  db.close();
  assert.equal((await readFile(`${databasePath}-wal`).catch(() => null)), null);
});

test('watcher coalesces events and enforces single-flight updates', async () => {
  const events = [];
  let callback;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const controller = createCrgWatcher({ root: '/workspace', debounceMs: 1, watchImpl: (_root, _options, listener) => { callback = listener; return { close() {} }; }, runUpdate: ({ changedPaths }) => { events.push(changedPaths); return gate; } });
  callback('change', 'a.js'); callback('change', 'b.js');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(controller.state(), { running: true, pending: false, changedPaths: [], stopped: false });
  callback('change', 'c.js');
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(events, [['a.js', 'b.js'], ['c.js']]);
  controller.close();
});
