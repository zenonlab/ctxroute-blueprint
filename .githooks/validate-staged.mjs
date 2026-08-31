import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeSource, isSupportedSourcePath } from './sensor-engine.mjs';

const files = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const failures = [];
const temporary = mkdtempSync(join(tmpdir(), 'staged-validation-'));

try {
  for (const [index, file] of files.entries()) {
    const source = stagedSource(file);
    validateSensor(file, source);
    if (/\.(?:js|mjs|cjs)$/iu.test(file)) validateJavaScript(file, source, index);
    if (/\.json$/iu.test(file)) {
      try { JSON.parse(source); }
      catch { failures.push(`${file}: invalid JSON`); }
    }
  }
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

function validateSensor(file, source) {
  if (!isSupportedSourcePath(file)) return;
  let config;
  try { config = JSON.parse(readFileSync('.project/sensor-rules.json', 'utf8')); }
  catch (error) { failures.push(`.project/sensor-rules.json: Sensor configuration unavailable (${error.message})`); return; }
  const diagnostics = analyzeSource(file, source, { config });
  const blocking = diagnostics.filter(item => item.severity === 'UNSAFE' || item.severity === 'ERROR');
  if (blocking.length) failures.push(...blocking.map(item => `${item.path}:${item.line}:${item.column} ${item.rule}: ${item.message}`));
}

function validateJavaScript(file, source, index) {
  const path = join(temporary, `${index}${extname(file)}`);
  writeFileSync(path, source);
  try { execFileSync('node', ['--check', path], { stdio: 'pipe' }); }
  catch { failures.push(`${file}: invalid JavaScript`); }
}
