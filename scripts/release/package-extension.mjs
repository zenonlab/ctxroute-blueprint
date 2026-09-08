import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createDeterministicZip } from './deterministic-zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const extensionRoot = join(root, 'apps/extension');
const outputRoot = join(extensionRoot, '.output');
const packageRoot = join(outputRoot, 'packages');
const version = JSON.parse(readFileSync(join(extensionRoot, 'package.json'), 'utf8')).version;
const siteOrigin = 'https://tobirink.com';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, WXT_PUBLIC_SITE_ORIGIN: siteOrigin }, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}.`);
}

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function packageTarget(target, sourceRoot = outputRoot, destination = packageRoot) {
  const source = join(sourceRoot, target);
  const builtManifest = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  const expectedMatch = `${siteOrigin}/*`;
  if (builtManifest.version !== version) throw new Error(`Manifest version mismatch for ${target}.`);
  if (!builtManifest.content_scripts?.some((entry) => entry.matches?.includes(expectedMatch))) throw new Error(`WebBridge origin missing for ${target}.`);
  if (!builtManifest.externally_connectable?.matches?.includes(expectedMatch)) throw new Error(`External origin missing for ${target}.`);
  const entries = filesUnder(source).map((path) => ({ content: readFileSync(path), name: relative(source, path) }));
  const first = createDeterministicZip(entries);
  const second = createDeterministicZip(entries);
  if (!first.equals(second)) throw new Error(`Non-deterministic archive for ${target}.`);

  const artifact = `tobirink-${target}-${version}.zip`;
  writeFileSync(join(destination, artifact), first);
  return {
    artifact,
    files: entries.length,
    sha256: createHash('sha256').update(first).digest('hex'),
    size: first.length,
    target,
    version,
  };
}

async function verifyIsolatedBuilds() {
  const { build } = await import('wxt');
  mkdirSync(join(root, 'build/.output'), { recursive: true });
  const verificationRoot = mkdtempSync(join(root, 'build/.output/release-repro-'));
  process.env.WXT_PUBLIC_SITE_ORIGIN = siteOrigin;
  const runs = [];
  for (let index = 0; index < 2; index += 1) {
    const output = mkdtempSync(join(verificationRoot, 'run-'));
    await build({ browser: 'chrome', outDir: output, root: extensionRoot });
    await build({ browser: 'firefox', outDir: output, root: extensionRoot });
    const artifacts = [packageTarget('chrome-mv3', output, output), packageTarget('firefox-mv3', output, output)];
    runs.push({ artifacts, output });
  }
  for (const artifact of runs[0].artifacts) {
    const first = readFileSync(join(runs[0].output, artifact.artifact));
    const second = readFileSync(join(runs[1].output, artifact.artifact));
    if (!first.equals(second)) throw new Error(`Independent builds differ for ${artifact.target}; evidence retained in ${verificationRoot}.`);
  }
  const manifest = { reproducible: true, runs, schemaVersion: 1, siteOrigin, version };
  writeFileSync(join(verificationRoot, 'verification.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv.length === 3 && process.argv[2] === '--verify-isolated') {
  await verifyIsolatedBuilds();
} else if (process.argv.length === 2) {
  run('npm', ['run', 'build:extension']);
  run('npm', ['run', 'build:extension:firefox']);
  mkdirSync(packageRoot, { recursive: true });
  const artifacts = [packageTarget('chrome-mv3'), packageTarget('firefox-mv3')];
  const manifest = { artifacts, schemaVersion: 1, siteOrigin, version };
  writeFileSync(join(packageRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} else {
  throw new Error('Usage: package-extension.mjs [--verify-isolated]');
}
