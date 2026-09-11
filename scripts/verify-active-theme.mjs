#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMITS = Object.freeze({ descriptor: 32_768, entry: 1_048_576, interface: 8_388_608,
  thumbnail: 16_777_216, binary: 1_073_741_824 });
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validatePackage = ajv.compile({
  type: 'object',
  required: ['format', 'id', 'display_name', 'entry', 'renderer'],
  properties: {
    format: { const: 'orbite.theme-package/1' },
    id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9._-]{0,95}$' },
    display_name: { type: 'string', minLength: 1, maxLength: 80 },
    entry: {
      type: 'object', required: ['format', 'path'],
      properties: {
        format: { enum: ['orbite.scene-probe/1', 'orbite.theme-package/2'] },
        path: { type: 'string', minLength: 1, maxLength: 240 }
      },
      additionalProperties: false
    },
    renderer: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9._-]{0,95}$' },
    thumbnail: { type: 'string', minLength: 1, maxLength: 240 },
    interface: { type: 'string', minLength: 1, maxLength: 240 }
  },
  additionalProperties: false
});
const validateJSONHeader = ajv.compile({
  type: 'object', required: ['format'],
  properties: { format: { type: 'string', minLength: 1, maxLength: 96 } }
});

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--package', '--binary', '--pid', '--output'].includes(key) || value === undefined) {
      throw new Error('usage: verify-active-theme --package PATH [--binary PATH] [--pid PID] [--output PATH]');
    }
    options[key.slice(2)] = value;
  }
  if (!options.package) throw new Error('--package is required');
  if ((options.binary && !options.pid) || (!options.binary && options.pid)) {
    throw new Error('--binary and --pid must be provided together');
  }
  if (options.pid && !/^[1-9][0-9]{0,9}$/u.test(options.pid)) throw new Error('invalid PID');
  return options;
}

async function boundedRegular(path, maximum, root) {
  const symbolic = await lstat(path);
  if (!symbolic.isFile() || symbolic.isSymbolicLink() || symbolic.size < 1 || symbolic.size > maximum) {
    throw new Error(`bounded regular file required: ${path}`);
  }
  const canonical = await realpath(path);
  if (root) {
    const distance = relative(root, canonical);
    if (distance.startsWith('..') || isAbsolute(distance)) throw new Error('package artifact escapes root');
  }
  return { canonical, bytes: await readFile(canonical), mode: symbolic.mode };
}

function contained(root, candidate) {
  if (candidate !== String(candidate) || candidate.length < 1 || candidate.length > 240 ||
      isAbsolute(candidate) || candidate.includes('\\') || candidate.includes(':')) {
    throw new Error('safe relative package path required');
  }
  const path = resolve(root, candidate);
  const distance = relative(root, path);
  if (distance.startsWith('..') || isAbsolute(distance)) throw new Error('package path escapes root');
  return path;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function experimentalPaths(value, path = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => experimentalPaths(entry, `${path}[${index}]`, found));
  } else if (value && value === Object(value)) {
    if (value.experimental === true || value.status === 'experimental') found.push(path);
    for (const [key, entry] of Object.entries(value)) experimentalPaths(entry, `${path}.${key}`, found);
  }
  return found;
}

async function jsonArtifact(label, path, maximum, root) {
  const file = await boundedRegular(path, maximum, root);
  let value;
  try { value = JSON.parse(file.bytes.toString('utf8')); }
  catch { throw new Error(`${label} is not valid JSON`); }
  return {
    receipt: { label, path: file.canonical, bytes: file.bytes.length, sha256: sha256(file.bytes) },
    value,
    experimental: experimentalPaths(value).map(item => `${label}:${item}`)
  };
}

export async function inspectActiveTheme({ packagePath, binaryPath, pid, processLookup = lookupProcess } = {}) {
  const descriptor = await jsonArtifact('package', resolve(packagePath), LIMITS.descriptor);
  const root = dirname(descriptor.receipt.path);
  const packageValue = descriptor.value;
  if (!validatePackage(packageValue)) {
    throw new Error(`unsupported theme package descriptor: ${ajv.errorsText(validatePackage.errors)}`);
  }

  const artifacts = [descriptor.receipt];
  const experimental = [...descriptor.experimental];
  const entry = await jsonArtifact('entry', contained(root, packageValue.entry.path), LIMITS.entry, root);
  if (!validateJSONHeader(entry.value) || entry.value.format !== packageValue.entry.format) {
    throw new Error('package entry format does not match its artifact');
  }
  artifacts.push(entry.receipt); experimental.push(...entry.experimental);
  if (packageValue.interface) {
    const ui = await jsonArtifact('interface', contained(root, packageValue.interface), LIMITS.interface, root);
    if (!validateJSONHeader(ui.value) || !ui.value.format.startsWith('orbite.theme-interface/')) {
      throw new Error('unsupported theme interface artifact');
    }
    artifacts.push(ui.receipt); experimental.push(...ui.experimental);
  }
  if (packageValue.thumbnail) {
    const thumbnail = await boundedRegular(contained(root, packageValue.thumbnail), LIMITS.thumbnail, root);
    if (!thumbnail.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('theme thumbnail is not a PNG');
    }
    artifacts.push({ label: 'thumbnail', path: thumbnail.canonical, bytes: thumbnail.bytes.length,
      sha256: sha256(thumbnail.bytes) });
  }

  let process = null;
  if (binaryPath && pid) {
    const binary = await boundedRegular(resolve(binaryPath), LIMITS.binary);
    if ((binary.mode & 0o111) === 0) throw new Error('supplied binary is not executable');
    const command = processLookup(Number(pid));
    const matchesBinary = command.includes(binary.canonical);
    artifacts.push({ label: 'binary', path: binary.canonical, bytes: binary.bytes.length,
      sha256: sha256(binary.bytes) });
    process = { pid: Number(pid), command, binary_path: binary.canonical, matches_binary: matchesBinary };
    if (!matchesBinary) throw new Error('PID does not reference the supplied binary');
  }

  return {
    format: 'orbite.active-theme-receipt/1',
    generated_at: new Date().toISOString(),
    theme_id: packageValue.id,
    qualified: experimental.length === 0,
    artifacts,
    process,
    experimental_fields: experimental
  };
}

function lookupProcess(pid) {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8', timeout: 2_000, maxBuffer: 16_384
    }).trim();
  } catch { throw new Error('PID is not running'); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const receipt = await inspectActiveTheme({ packagePath: options.package, binaryPath: options.binary,
    pid: options.pid });
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.output) await writeFile(resolve(options.output), output, { flag: 'wx', mode: 0o600 });
  process.stdout.write(output);
  if (!receipt.qualified) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
