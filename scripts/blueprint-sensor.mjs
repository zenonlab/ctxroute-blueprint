import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { analyzePaths, isSupportedSourcePath, toSarif } from '../.githooks/sensor-engine.mjs';

const SCOPES = ['.codex/hooks/', '.githooks/', 'scripts/'];
const BLOCKING = new Set(['UNSAFE', 'ERROR']);

export function evaluateBaseline(diagnostics, baseline) {
  const failures = [];
  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline?.exceptions)) failures.push('baseline must declare schemaVersion 1 and an exceptions array');
  const allowance = Object.create(null);
  for (const exception of baseline?.exceptions ?? []) {
    const key = `${exception.path}\0${exception.rule}`;
    if (exception.path !== String(exception.path) || exception.rule !== String(exception.rule) || !Number.isInteger(exception.occurrences) || exception.occurrences < 1 || exception.justification !== String(exception.justification) || exception.justification.trim().length < 20 || Object.hasOwn(allowance, key)) failures.push(`invalid or duplicate baseline exception: ${exception.path ?? '(missing)'} ${exception.rule ?? '(missing)'}`);
    else allowance[key] = { remaining: exception.occurrences, exception };
  }

  const unexpected = [];
  const accepted = [];
  for (const diagnostic of diagnostics.filter(item => BLOCKING.has(item.severity))) {
    const key = `${diagnostic.path}\0${diagnostic.rule}`;
    const entry = allowance[key];
    if (entry?.remaining > 0) { entry.remaining -= 1; accepted.push(diagnostic); }
    else unexpected.push(diagnostic);
  }
  const stale = Object.values(allowance).filter(entry => entry.remaining > 0).map(entry => ({ ...entry.exception, missingOccurrences: entry.remaining }));
  return { ok: failures.length === 0 && unexpected.length === 0 && stale.length === 0, failures, accepted, unexpected, stale };
}

export function trackedBlueprintSources() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(path => path && existsSync(path) && SCOPES.some(scope => path.startsWith(scope)) && isSupportedSourcePath(path));
}

function main() {
  const baseline = JSON.parse(readFileSync('.project/sensor-baseline.json', 'utf8'));
  const paths = trackedBlueprintSources();
  const result = analyzePaths(paths);
  const baselineResult = evaluateBaseline(result.diagnostics, baseline);
  const report = {
    ...result,
    gate: baselineResult.ok ? 'PASS' : 'FAIL',
    scannedFiles: paths.length,
    baseline: {
      accepted: baselineResult.accepted,
      unexpected: baselineResult.unexpected,
      stale: baselineResult.stale,
      failures: baselineResult.failures,
    },
  };
  const summary = {
    schemaVersion: result.schemaVersion,
    gate: report.gate,
    verdict: result.verdict,
    scannedFiles: paths.length,
    diagnostics: Object.fromEntries(['WARN', 'UNSAFE', 'ERROR'].map(severity => [severity, result.diagnostics.filter(item => item.severity === severity).length])),
    baseline: { accepted: baselineResult.accepted.length, unexpected: baselineResult.unexpected.length, stale: baselineResult.stale.length, failures: baselineResult.failures },
  };
  const output = process.argv.includes('--sarif') ? toSarif({ diagnostics: baselineResult.unexpected }) : process.argv.includes('--summary') ? summary : report;
  process.stdout.write(`${JSON.stringify(output)}\n`);
  if (!baselineResult.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
