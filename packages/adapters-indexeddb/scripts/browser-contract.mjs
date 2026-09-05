import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = process.argv[2] ?? '/test/index.html';
const chromeCandidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error('Chrome or Chromium is required for the IndexedDB contract.');

const delay = (milliseconds) => new Promise((resolve) => { setTimeout(resolve, milliseconds); });

function launchChrome(executable, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Chromium DevTools endpoint timed out after 10 seconds.'));
    }, 10000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve({ child, debuggerUrl: match[1] });
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`Chromium exited with ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function pageTarget(debuggerUrl) {
  const endpoint = new URL(debuggerUrl);
  if (endpoint.hostname !== '127.0.0.1' || !/^\d+$/u.test(endpoint.port)) throw new Error('Chromium exposed a non-local DevTools endpoint.');
  const targets = await new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', path: '/json/list', port: Number(endpoint.port) }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Chromium target list returned HTTP ${response.statusCode}.`));
        return;
      }
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 65536) request.destroy(new Error('Chromium target list exceeded 64 KiB.'));
      });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
  });
  const page = targets.find((target) => target.type === 'page' && target.url?.includes(fixturePath));
  if (!page?.webSocketDebuggerUrl) throw new Error('Chromium did not expose a page target.');
  return page.webSocketDebuggerUrl;
}

async function connectRuntime(webSocketUrl) {
  const socket = new globalThis.WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => { pending.set(id, { reject, resolve }); });
    },
  };
}

async function stopChrome(child) {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolve) => { child.addListener('close', resolve); });
  child.kill('SIGTERM');
  await Promise.race([closed, delay(2000)]);
}

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  resolve: {
    alias: {
      '@tobirink/application': fileURLToPath(new URL('../../application/src/index.ts', import.meta.url)),
      '@tobirink/contracts': fileURLToPath(new URL('../../contracts/src/index.ts', import.meta.url)),
      '@tobirink/domain': fileURLToPath(new URL('../../domain/src/index.ts', import.meta.url)),
    },
  },
  root: packageRoot,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
const profile = mkdtempSync(join(tmpdir(), 'tobirink-indexeddb-'));
let launched;
let runtime;

try {
  await server.listen();
  const address = server.httpServer?.address();
  const port = address?.port;
  if (!Number.isInteger(port)) throw new Error('Vite did not expose a local TCP port.');
  launched = await launchChrome(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `http://127.0.0.1:${port}${fixturePath}`,
  ]);
  runtime = await connectRuntime(await pageTarget(launched.debuggerUrl));
  const deadline = Date.now() + 10000;
  let status = 'pending';
  let detail = '';
  while (status === 'pending' && Date.now() < deadline) {
    const evaluation = await runtime.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ status: document.body.dataset.status, detail: document.body.textContent })',
      returnByValue: true,
    });
    const result = JSON.parse(evaluation.result.value);
    status = result.status ?? 'pending';
    detail = result.detail ?? '';
    if (status === 'pending') await delay(50);
  }
  if (status !== 'passed') throw new Error(`IndexedDB browser contract failed with ${status}: ${detail}`);
  process.stdout.write(`IndexedDB browser contract passed in Chromium for ${fixturePath}.\n`);
} finally {
  runtime?.close();
  await stopChrome(launched?.child);
  await server.close();
  rmSync(profile, { force: true, recursive: true });
}
