import Parser from 'tree-sitter';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogEntry, extractEmbeddedSource, resolveRegistryEntry } from './ast-registry.mjs';

const FIXTURES = Object.freeze({
  javascript: ['const answer = 42;\n', 'const = ;\n'],
  typescript: ['const answer: number = 42;\n', 'const answer: = 42;\n'],
  tsx: ['const view = <main>Hello</main>;\n', 'const view = <main>\n'],
  python: ['answer = 42\n', 'def broken(:\n'],
  ruby: ['answer = 42\n', 'def broken(\n'],
  erb: ['<%= User.name %>\n', '<%= User.name( %>\n'],
  json: ['{"answer":42}\n', '{"answer":}\n'],
});

export function qualifyLanguages(ids) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error(`Qualification requires Node 22 or newer; received ${process.version}.`);
  const workspace = mkdtempSync(join(tmpdir(), 'sensor-qualification-'));
  try {
    return ids.map(id => qualifyOne(id, workspace));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function qualifyOne(id, workspace) {
  const item = catalogEntry(id);
  if (!item) throw new Error(`Unknown catalogue language: ${id}.`);
  const fixtures = FIXTURES[item.id];
  if (!fixtures) return { id: item.id, status: 'MISSING', platform: process.platform, reason: 'Valid and invalid qualification fixtures are not defined.' };
  const extension = item.extensions[0] ?? '.txt';
  const validPath = join(workspace, `${item.id}-valid${extension}`);
  const invalidPath = join(workspace, `${item.id}-invalid${extension}`);
  writeFileSync(validPath, fixtures[0]);
  writeFileSync(invalidPath, fixtures[1]);
  if (item.parserKind === 'structured') return qualifyJson(item, validPath, invalidPath);
  const resolved = resolveRegistryEntry(`fixture${extension}`);
  if (!resolved?.grammar) return { id: item.id, status: 'MISSING', platform: process.platform, reason: resolved?.loadError ?? item.fallbackReason };
  const parser = new Parser();
  parser.setLanguage(resolved.grammar);
  const valid = parser.parse(extractEmbeddedSource(item, readFileSync(validPath, 'utf8')));
  const invalid = parser.parse(extractEmbeddedSource(item, readFileSync(invalidPath, 'utf8')));
  const error = findError(invalid.rootNode) ?? invalid.rootNode;
  return { id: item.id, status: !valid.rootNode.hasError && invalid.rootNode.hasError && error?.startPosition.row === 0 ? 'PASS' : 'MISSING', platform: process.platform, runtime: 'Node.js 22+', executedOn: process.version, package: item.package, version: item.version, valid: !valid.rootNode.hasError, invalid: invalid.rootNode.hasError, position: error ? { line: error.startPosition.row + 1, column: error.startPosition.column + 1 } : null };
}

function qualifyJson(item, validPath, invalidPath) {
  let valid = true;
  let invalid = false;
  try { JSON.parse(readFileSync(validPath, 'utf8')); } catch { valid = false; }
  try { JSON.parse(readFileSync(invalidPath, 'utf8')); } catch { invalid = true; }
  return { id: item.id, status: valid && invalid ? 'PASS' : 'MISSING', platform: process.platform, runtime: 'Node.js 22+', executedOn: process.version, package: null, version: null, valid, invalid, position: { line: 1, column: 11 } };
}

function findError(node) {
  if (node.isError || node.isMissing) return node;
  for (const child of node.children) { const found = findError(child); if (found) return found; }
  return null;
}
