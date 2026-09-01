import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('tools/oxlint/anti-slop');
const provenance = JSON.parse(readFileSync(join(root, 'PROVENANCE.json'), 'utf8'));
const files = walk(root).filter(path => !path.endsWith('PROVENANCE.json') && !path.endsWith('LOCAL_CHANGES.md')).sort();
const lines = files.map(path => `${digest(readFileSync(path))}  ${relative(process.cwd(), path)}\n`).join('');
const actual = digest(lines);
if (actual !== provenance.snapshotSha256) {
  console.error(`anti-slop snapshot drift: expected ${provenance.snapshotSha256}, found ${actual}`);
  process.exit(1);
}
console.log(`anti-slop snapshot ${provenance.commit} verified (${files.length} files).`);

function walk(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(directory, item.name)) : [join(directory, item.name)]); }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
