import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const expected = new Map([
  ['packages/ctxroute', 'zenonlab/ctxroute'],
  ['packages/archify', 'tt-a1i/archify'],
  ['packages/code-review-graph', 'tirth8205/code-review-graph'],
]);
const failures = [];
const rootPackage = await readJson(join(root, 'package.json'), 'package.json');
if (!Array.isArray(rootPackage?.workspaces) || !rootPackage.workspaces.includes('packages/*')) failures.push('root package.json must declare the packages/* npm workspace');

const names = new Set();
for (const [relativePath, source] of expected) {
  const manifest = await readJson(join(root, relativePath, 'package.json'), `${relativePath}/package.json`);
  if (!manifest) continue;
  if (names.has(manifest.name)) failures.push(`${relativePath}: duplicate workspace name ${manifest.name}`);
  names.add(manifest.name);
  if (manifest.private !== true) failures.push(`${relativePath}: workspace boundary must remain private`);
  if (manifest.license !== 'Apache-2.0') failures.push(`${relativePath}: license must be Apache-2.0`);
  if (manifest.engines?.node !== '>=22.13.0') failures.push(`${relativePath}: Node.js 22.13+ compatibility is required`);
  if (manifest.blueprintSource !== source) failures.push(`${relativePath}: blueprintSource must be ${source}`);
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, workspaces: [...expected.keys()] }));

async function readJson(path, label) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { failures.push(`${label}: ${error.code === 'ENOENT' ? 'missing' : 'invalid JSON'}`); return null; }
}
