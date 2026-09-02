import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const configPath = '.project/project-config.json';
const npmCli = process.env.npm_execpath;
if (!npmCli) fail('Run initialization through npm: npm run initialize.');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.status === 'initialized') { run('Validate initialized blueprint', process.execPath, [npmCli, 'run', 'validate']); console.log('Blueprint is already initialized.'); process.exit(0); }
if (config.status !== 'template') fail(`Cannot initialize from status ${config.status ?? '(missing)'}.`);
const missing = Object.entries(config.decisions ?? {})
  .filter(([, value]) => value !== String(value) || !value.trim() || hasPlaceholder(value))
  .map(([name]) => `decision: ${name}`);
for (const file of ['docs/00-project-brief.md', 'docs/01-technology-decisions.md', 'docs/02-quality-strategy.md']) {
  if (hasPlaceholder(readFileSync(file, 'utf8'))) missing.push(`placeholder: ${file}`);
}
if (missing.length) fail(`Initialization blocked; complete ${missing.join(', ')}.`);
try {
  run('Validate blueprint before transition', process.execPath, [npmCli, 'run', 'validate']);
} catch (error) {
  fail(error.message);
}
const temporary = `${configPath}.tmp-${process.pid}`;
let transitioned = false;
writeFileSync(temporary, `${JSON.stringify({ ...config, status: 'initialized' }, null, 2)}\n`, 'utf8');
renameSync(temporary, configPath);
transitioned = true;
try {
  run('Validate initialized blueprint', process.execPath, [npmCli, 'run', 'validate']);
  console.log('Blueprint initialized by npm.');
} catch (error) {
  if (transitioned) writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fail(error.message);
}

function run(label, command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`${label} failed.`);
}
function hasPlaceholder(source) { return /\[[^\]\r\n]+\](?!\s*(?:\(|\[))/u.test(source); }
function fail(message) { console.error(message); process.exit(1); }
