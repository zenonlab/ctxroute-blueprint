import { join } from 'node:path';

const root = process.cwd();
const files = [
  join(root, 'packages/metadata/src/index.ts'),
  join(root, 'apps/worker/src'),
];
const forbidden = /(?:anilist-v1|mangaupdates-v1|Dororo|Hyakkimaru|The Dreaming Man)/iu;
const { execFileSync } = await import('node:child_process');
let result = '';
try { result = execFileSync('rg', ['-n', '--glob', '*.ts', '--glob', '!*.test.ts', forbidden.source, ...files], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (error) { result = error.stdout?.toString?.() ?? ''; }
if (result.trim()) {
  console.error(`Forbidden provider lexicon found:\n${result}`);
  process.exit(1);
}
