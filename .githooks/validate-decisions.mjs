import { execFileSync } from 'node:child_process';
import { loadAdrs, normalizePath } from '../.codex/hooks/decision-memory.mjs';

const adrs = loadAdrs(process.cwd());
const failures = adrs.flatMap(adr => adr.errors);
const names = new Set(adrs.map(adr => adr.file));
for (const adr of adrs) {
  const replacement = adr.metadata?.['superseded-by'];
  if (replacement && !names.has(`docs/decisions/${replacement}`)) failures.push(`${adr.file}: superseded-by target does not exist: ${replacement}`);
  for (const scope of adr.metadata?.scope ?? []) if (scope.startsWith('/') || scope.includes('..')) failures.push(`${adr.file}: scope contains an invalid path: ${scope}`);
}
if (process.argv.includes('--staged')) {
  for (const file of stagedFiles().filter(file => /^docs\/decisions\/ADR-(?!0000-).+\.md$/u.test(file))) {
    const adr = adrs.find(item => item.file === file);
    if (adr && !adr.metadata?.revised && !adr.metadata?.['superseded-by']) failures.push(`${file}: modified ADR must set revised: true or superseded-by`);
  }
}
if (failures.length) { console.error([...new Set(failures)].join('\n')); process.exit(1); }
console.log(JSON.stringify({ decisions: adrs.length, scopes: adrs.reduce((count, adr) => count + (adr.metadata?.scope?.length ?? 0), 0) }));

function stagedFiles() {
  try { return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=M', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean).map(normalizePath); }
  catch { return []; }
}
