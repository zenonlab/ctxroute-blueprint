import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTROL_DIRECTORIES, CONTROL_FILES, trackedControlFiles } from './blueprint-sync.mjs';

const MARKER = '.project/blueprint-version.json';

export function controlHash(root = process.cwd()) {
  const hash = createHash('sha256');
  for (const file of trackedControlFiles(root).filter(file => file !== MARKER)) {
    hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function checkBlueprintVersion(root = process.cwd()) {
  const marker = readMarker(root);
  const expected = controlHash(root);
  const failures = [];
  if (marker.controlHash !== expected) failures.push('controlHash does not match the tracked control plane; bump the version and run blueprint:version:update');

  const baseline = baselineRef(root);
  if (baseline && changedControlFiles(root, baseline).length) {
    const previous = readMarkerFromGit(root, baseline);
    if (previous?.version === marker.version) failures.push(`version ${marker.version} was not bumped for control-plane changes since ${baseline}`);
  }
  return { ok: failures.length === 0, version: marker.version, controlHash: marker.controlHash, expected, baseline, failures };
}

export function updateBlueprintHash(root = process.cwd()) {
  const marker = readMarker(root);
  const baseline = baselineRef(root);
  if (baseline && changedControlFiles(root, baseline).length && readMarkerFromGit(root, baseline)?.version === marker.version) {
    throw new Error(`Bump blueprint version ${marker.version} before updating its control hash.`);
  }
  marker.controlHash = controlHash(root);
  writeFileSync(resolve(root, MARKER), `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

function readMarker(root) {
  const marker = JSON.parse(readFileSync(resolve(root, MARKER), 'utf8'));
  if (marker.schemaVersion !== 1 || marker.version !== String(marker.version ?? '')) throw new Error('Invalid blueprint version marker.');
  return marker;
}

function baselineRef(root) {
  if (gitList(root, ['diff', '--name-only', '-z', 'HEAD', '--', ...CONTROL_FILES, ...CONTROL_DIRECTORIES]).length
    || gitList(root, ['diff', '--cached', '--name-only', '-z', 'HEAD', '--', ...CONTROL_FILES, ...CONTROL_DIRECTORIES]).length) return 'HEAD';
  const candidates = [process.env.BLUEPRINT_BASE_REF];
  const branch = git(root, ['branch', '--show-current'], true);
  if (branch && branch !== 'main') candidates.push('origin/main');
  candidates.push('HEAD^');
  return candidates.find(candidate => candidate && git(root, ['rev-parse', '--verify', candidate], true));
}

function changedControlFiles(root, baseline) {
  const tracked = new Set(trackedControlFiles(root));
  const changed = new Set([
    ...gitList(root, ['diff', '--name-only', '-z', baseline, '--', ...CONTROL_FILES, ...CONTROL_DIRECTORIES]),
    ...gitList(root, ['diff', '--name-only', '-z', '--', ...CONTROL_FILES, ...CONTROL_DIRECTORIES]),
    ...gitList(root, ['diff', '--cached', '--name-only', '-z', '--', ...CONTROL_FILES, ...CONTROL_DIRECTORIES]),
  ]);
  return [...changed].filter(file => tracked.has(file) && file !== MARKER);
}

function readMarkerFromGit(root, ref) {
  const body = git(root, ['show', `${ref}:${MARKER}`], true);
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

function gitList(root, args) {
  return git(root, args, true).split('\0').filter(Boolean);
}

function git(root, args, quiet = false) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] }).trim(); }
  catch { return ''; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    if (process.argv.includes('--write')) {
      process.stdout.write(`${JSON.stringify(updateBlueprintHash(), null, 2)}\n`);
    } else {
      const result = checkBlueprintVersion();
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if (!result.ok) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
