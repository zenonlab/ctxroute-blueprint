import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { grammarStatus, SENSOR_COVERAGE } from './sensor-engine.mjs';

export function runChecklist(root = process.cwd()) {
  const statuses = grammarStatus();
  const adapters = statuses.map(item => ({ ...item, extensions: [...item.extensions], filenames: [...item.filenames] }));
  const extensionCount = new Set(adapters.flatMap(item => item.extensions)).size;
  const filenameCount = new Set(adapters.flatMap(item => item.filenames)).size;
  const project = readJson(resolve(root, '.project/project-config.json'));
  const configured = project?.quality?.sensor?.languages ?? [];
  const configuredStatuses = configured.map(id => adapters.find(item => item.id === id)).filter(Boolean);
  const checks = [
    check('catalog-classification', extensionCount === 113 && filenameCount === 9, `${extensionCount} extensions / ${filenameCount} filenames`),
    check('no-false-pass', adapters.every(item => item.status !== 'PASS' || item.syntaxAware), `${adapters.filter(item => item.status === 'PASS').length} syntax-aware PASS / ${adapters.filter(item => item.status === 'PARTIAL').length} PARTIAL / ${adapters.filter(item => item.status === 'MISSING').length} MISSING`),
    check('configured-languages', configured.length > 0 && configuredStatuses.length === configured.length, configured.join(', ')),
    check('configured-parsers', configuredStatuses.every(item => item.syntaxAware), configuredStatuses.map(item => `${item.id}: ${item.status}`).join(', ')),
    check('bounded-module-scope', SENSOR_COVERAGE.moduleScope === 'explicit-paths' && SENSOR_COVERAGE.packageResolution === 'disabled' && !SENSOR_COVERAGE.wholeProgramAnalysis, SENSOR_COVERAGE.moduleScope),
    check('runtime-rate-limit', SENSOR_COVERAGE.rateLimitRuntimeProof === false, 'heuristic only'),
    check('rules', existsSync(resolve(root, '.project/sensor-rules.json')), '.project/sensor-rules.json'),
    check('architecture', existsSync(resolve(root, 'docs/architecture/src/blueprint.architecture.json')), 'Archify source'),
    check('tests', existsSync(resolve(root, 'tests/sensor.test.mjs')) && existsSync(resolve(root, 'tests/sensor-languages.test.mjs')), 'engine + language packs'),
  ];
  return { schemaVersion: 2, catalogVersion: 1, status: checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', adapters, configured, checks };
}

export function formatChecklist(result) { return ['Sensor checklist', ...result.checks.map(item => `[${item.status}] ${item.name}: ${item.detail}`), `Result: ${result.status}`].join('\n'); }
function check(name, passed, detail) { return { name, status: passed ? 'PASS' : 'MISSING', detail }; }
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } }
