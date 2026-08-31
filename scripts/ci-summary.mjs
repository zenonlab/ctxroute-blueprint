import { appendFileSync, writeFileSync } from 'node:fs';

const summary = [
  '# Blueprint validation summary',
  '',
  '- Node.js 22 / npm 10+',
  '- Stack-neutral template; no product deployment',
  '- CI artifacts are Archify HTML, Sensor SARIF, and this summary',
  '- Diagnostics are generated from repository-relative paths only',
  ''
].join('\n');
writeFileSync('ci-summary.md', summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
