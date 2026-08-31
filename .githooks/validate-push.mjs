import { execFileSync, spawnSync } from 'node:child_process';
import { loadProjectConfig } from './project-policy.mjs';

const preCommit = process.argv.includes('--pre-commit');
const { config, failures } = loadProjectConfig();

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

const commands = [];
if (preCommit) {
  if (config.quality.mutation.preCommit) commands.push(['mutation', config.commands.mutation]);
} else {
  const names = config.status === 'template' ? ['test'] : ['lint', 'typecheck', 'test', 'integration', 'build'];
  for (const name of names) {
    if (config.commands[name]) commands.push([name, config.commands[name]]);
  }
  if (config.quality.mutation.prePush) commands.push(['mutation', config.commands.mutation]);
}

for (const [name, command] of commands) {
  console.error(`Running ${name}: ${command}`);
  const env = { ...process.env };
  const localGitVariables = execFileSync('git', ['rev-parse', '--local-env-vars'], { cwd: process.cwd(), encoding: 'utf8' }).trim().split(/\r?\n/u);
  for (const variable of localGitVariables) delete env[variable];
  const argv = parseCommand(command);
  if (!argv.length) { console.error(`${name} command is empty or invalid.`); process.exit(1); }
  const executable = process.platform === 'win32' && /^(?:npm|npx)$/u.test(argv[0]) ? `${argv[0]}.cmd` : argv[0];
  const result = spawnSync(executable, argv.slice(1), { cwd: process.cwd(), env, shell: false, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function parseCommand(command) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of String(command)) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = null; else current += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/u.test(character)) { if (current) { args.push(current); current = ''; } continue; }
    if (';&|<>'.includes(character)) return [];
    current += character;
  }
  if (escaped || quote) return [];
  if (current) args.push(current);
  return args;
}
