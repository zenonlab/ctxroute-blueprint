import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDeterministicZip } from './deterministic-zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionRoot = join(root, 'apps/extension');
const outputRoot = join(extensionRoot, '.output');
const packageRoot = join(outputRoot, 'packages');
const version = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')).version;

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
}

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function packageTarget(target) {
  const source = join(outputRoot, target);
  const entries = filesUnder(source).map((path) => ({ content: readFileSync(path), name: relative(source, path) }));
  const first = createDeterministicZip(entries);
  const second = createDeterministicZip(entries);
  if (!first.equals(second)) throw new Error(`Non-deterministic archive for ${target}.`);

  const artifact = `tobirink-${target}-${version}.zip`;
  writeFileSync(join(packageRoot, artifact), first);
  return {
    artifact,
    files: entries.length,
    sha256: createHash('sha256').update(first).digest('hex'),
    size: first.length,
    target,
    version,
  };
}

run('npm', ['run', 'build:extension']);
run('npm', ['run', 'build:extension:firefox']);
mkdirSync(packageRoot, { recursive: true });
const artifacts = [packageTarget('chrome-mv3'), packageTarget('firefox-mv3')];
const manifest = { artifacts, schemaVersion: 1 };
writeFileSync(join(packageRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
