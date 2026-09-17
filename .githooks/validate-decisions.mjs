import { execFileSync } from 'node:child_process';
import { loadAdrs, normalizePath, validateAdrRevision } from '../.codex/hooks/decision-memory.mjs';

const adrs = loadAdrs(process.cwd());
const failures = adrs.flatMap(adr => adr.errors);
const names = new Set(adrs.map(adr => adr.file));
const numericIds = new Map();
for (const adr of adrs) {
  const numericId = adr.file.match(/\/ADR-(\d{4})-/u)?.[1];
  if (numericId) {
    const previous = numericIds.get(numericId);
    if (previous) failures.push(`${adr.file}: ADR number ${numericId} is already used by ${previous}`);
    else numericIds.set(numericId, adr.file);
  }
  const replacement = adr.metadata?.['superseded-by'];
  if (replacement && !names.has(`docs/decisions/${replacement}`)) failures.push(`${adr.file}: superseded-by target does not exist: ${replacement}`);
  if (replacement && adr.file.endsWith(`/${replacement}`)) failures.push(`${adr.file}: ADR cannot supersede itself`);
  if (replacement) {
    const target = adrs.find(item => item.file === `docs/decisions/${replacement}`);
    if (target && !(target.metadata?.supersedes ?? []).includes(adr.file.split('/').at(-1))) failures.push(`${adr.file}: ${replacement} must declare the reverse supersedes relation`);
  }
  for (const prior of adr.metadata?.supersedes ?? []) {
    const target = adrs.find(item => item.file === `docs/decisions/${prior}`);
    if (!target) failures.push(`${adr.file}: supersedes target does not exist: ${prior}`);
    else if (target.metadata?.['superseded-by'] !== adr.file.split('/').at(-1)) failures.push(`${adr.file}: ${prior} must declare superseded-by: ${adr.file.split('/').at(-1)}`);
  }
  for (const scope of adr.metadata?.scope ?? []) if (scope.startsWith('/') || scope.includes('..')) failures.push(`${adr.file}: scope contains an invalid path: ${scope}`);
}
if (process.argv.includes('--staged')) {
  for (const file of stagedFiles().filter(file => /^docs\/decisions\/ADR-(?!0000-).+\.md$/u.test(file))) {
    const adr = adrs.find(item => item.file === file);
    const before = gitText(['show', `HEAD:${file}`]);
    const after = gitText(['show', `:${file}`]);
    if (adr && before !== null && after !== null) failures.push(...validateAdrRevision(before, after, file));
  }
}

function gitText(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exit(1); }
console.log(JSON.stringify({ decisions: adrs.length, scopes: adrs.reduce((count, adr) => count + (adr.metadata?.scope?.length ?? 0), 0) }));

function stagedFiles() {
  try { return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=M', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map(normalizePath); }
  catch { return []; }
}
