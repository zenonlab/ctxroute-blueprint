import { appendFileSync, writeFileSync } from 'node:fs';

const summary = [
  '# Blueprint validation summary',
  '',
  '- Node.js 22 / npm 10+ / Python 3.12 / uv 0.11.2',
  '- Stack-neutral template; no product deployment',
  '- CI artifacts include Archify visual evidence, CRG smoke, Sensor SARIF, and this summary',
  '- Diagnostics are generated from repository-relative paths only',
  ''
].join('\n');
writeFileSync('ci-summary.md', summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
