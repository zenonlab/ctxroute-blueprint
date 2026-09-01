import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { encode } from 'gpt-tokenizer';
import { summarizeFile } from './context-ast.mjs';
const check = process.argv.includes('--check');
const paths = process.argv.slice(2).filter(value => value && value !== '--check'); const rows = [];
const thresholds = JSON.parse(readFileSync('.project/context-benchmark.json', 'utf8'));
if (thresholds.schemaVersion !== 1 || !positive(thresholds.minimumObservedRatio) || !positive(thresholds.maximumSummaryTokens) || !positive(thresholds.maximumDurationMs)) throw new Error('Invalid .project/context-benchmark.json thresholds.');
for (const path of paths) {
  const full = readFileSync(path, 'utf8');
  const start = performance.now();
  const summary = summarizeFile(path);
  const elapsed = performance.now() - start;
  const fullTokens = encode(full).length;
  const summaryTokens = encode(JSON.stringify(summary)).length;
  rows.push({ path, language: summary.data.language, bytes: statSync(path).size, fullTokens, summaryTokens, observedRatio: Number((fullTokens / Math.max(1, summaryTokens)).toFixed(2)), tokenizer: summary.tokenizer, durationMs: Number(elapsed.toFixed(2)) });
}
const failures = rows.flatMap(row => [
  row.observedRatio < thresholds.minimumObservedRatio ? `${row.path}: observed ratio ${row.observedRatio} is below ${thresholds.minimumObservedRatio}` : null,
  row.summaryTokens > thresholds.maximumSummaryTokens ? `${row.path}: ${row.summaryTokens} summary tokens exceed ${thresholds.maximumSummaryTokens}` : null,
  row.durationMs > thresholds.maximumDurationMs ? `${row.path}: ${row.durationMs}ms exceeds ${thresholds.maximumDurationMs}ms` : null,
].filter(Boolean));
console.log(JSON.stringify({ methodology: 'Observed gpt-tokenizer@4.0.0 counts on the requested files; configured thresholds gate regressions but are not universal guarantees.', status: failures.length ? 'FAIL' : 'PASS', thresholds, failures, rows }, null, 2));
if (check && failures.length) process.exitCode = 1;
function positive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
