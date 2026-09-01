import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzePaths, isSupportedSourcePath } from './sensor-engine.mjs';

const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
const temporary = mkdtempSync(join(tmpdir(), 'staged-validation-'));
const sensorFiles = [];

try {
  for (const [index, file] of files.entries()) {
    const source = stagedSource(file);
    if (isSupportedSourcePath(file)) {
      const path = join(temporary, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
      sensorFiles.push(file);
    }
    if (/\.(?:js|mjs|cjs)$/iu.test(file)) validateJavaScript(file, source, index);
    if (/\.json$/iu.test(file)) {
      try { JSON.parse(source); }
      catch { failures.push(`${file}: invalid JSON`); }
    }
  }
  validateSensorBatch();
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

function stagedSource(file) {
  return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' });
}

function validateSensorBatch() {
  if (!sensorFiles.length) return;
  let config;
  try {
    config = JSON.parse(indexOrWorkingSource('.project/sensor-rules.json'));
    const project = JSON.parse(indexOrWorkingSource('.project/project-config.json'));
    config.languages = project.quality?.sensor?.languages ?? [];
  }
  catch (error) { failures.push(`.project/sensor-rules.json: Sensor configuration unavailable (${error.message})`); return; }
  const result = analyzePaths(sensorFiles, { root: temporary, config });
  const baseline = JSON.parse(indexOrWorkingSource('.project/sensor-baseline.json'));
  const allowance = new Map((baseline.exceptions ?? []).map(item => [[item.path, item.rule].join('\0'), item.occurrences]));
  const blocking = result.diagnostics.filter(item => item.severity === 'UNSAFE' || item.severity === 'ERROR').filter(item => {
    const signature = [item.path, item.rule].join('\0');
    const remaining = allowance.get(signature) ?? 0;
    if (remaining < 1) return true;
    allowance.set(signature, remaining - 1);
    return false;
  });
  if (blocking.length) failures.push(...blocking.map(item => `${item.path}:${item.line}:${item.column} ${item.rule}: ${item.message}`));
}

function indexOrWorkingSource(path) {
  return files.includes(path) ? stagedSource(path) : readFileSync(path, 'utf8');
}

function validateJavaScript(file, source, index) {
  const path = join(temporary, `${index}${extname(file)}`);
  writeFileSync(path, source);
  try { execFileSync('node', ['--check', path], { stdio: 'pipe' }); }
  catch { failures.push(`${file}: invalid JavaScript`); }
}
