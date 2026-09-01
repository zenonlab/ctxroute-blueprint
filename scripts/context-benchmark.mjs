import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { encode } from 'gpt-tokenizer';
import { summarizeFile } from './context-ast.mjs';
const paths = process.argv.slice(2).filter(Boolean); const rows = [];
for (const path of paths) {
  const full = readFileSync(path, 'utf8');
  const start = performance.now();
  const summary = summarizeFile(path);
  const elapsed = performance.now() - start;
  const fullTokens = encode(full).length;
  const summaryTokens = encode(JSON.stringify(summary)).length;
  rows.push({ path, language: summary.data.language, bytes: statSync(path).size, fullTokens, summaryTokens, observedRatio: Number((fullTokens / Math.max(1, summaryTokens)).toFixed(2)), tokenizer: summary.tokenizer, durationMs: Number(elapsed.toFixed(2)) });
}
console.log(JSON.stringify({ methodology: 'Observed gpt-tokenizer@4.0.0 counts on the requested files; ratios are measurements, not guarantees.', rows }, null, 2));
