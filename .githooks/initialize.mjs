import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const configPath = '.project/project-config.json';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.status === 'initialized') { run('Validate initialized blueprint', npm, ['run', 'validate']); console.log('Blueprint is already initialized.'); process.exit(0); }
if (config.status !== 'template') fail(`Cannot initialize from status ${config.status ?? '(missing)'}.`);
const missing = Object.entries(config.decisions ?? {})
  .filter(([, value]) => typeof value !== 'string' || !value.trim() || /\[[^\]]+\]/u.test(value))
  .map(([name]) => `decision: ${name}`);
for (const file of ['docs/00-project-brief.md', 'docs/01-technology-decisions.md', 'docs/02-quality-strategy.md']) {
  if (/\[[^\]]+\]/u.test(readFileSync(file, 'utf8'))) missing.push(`placeholder: ${file}`);
}
if (missing.length) fail(`Initialization blocked; complete ${missing.join(', ')}.`);
try {
  run('Validate blueprint before transition', npm, ['run', 'validate']);
} catch (error) {
  fail(error.message);
}
const temporary = `${configPath}.tmp-${process.pid}`;
let transitioned = false;
writeFileSync(temporary, `${JSON.stringify({ ...config, status: 'initialized' }, null, 2)}\n`, 'utf8');
renameSync(temporary, configPath);
transitioned = true;
try {
  run('Validate initialized blueprint', npm, ['run', 'validate']);
  console.log('Blueprint initialized by npm.');
} catch (error) {
  if (transitioned) writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fail(error.message);
}

function run(label, command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
}
function fail(message) { console.error(message); process.exit(1); }
