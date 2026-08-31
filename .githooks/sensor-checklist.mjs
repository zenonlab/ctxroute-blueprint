import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SENSOR_ADAPTERS, SENSOR_COVERAGE } from './sensor-engine.mjs';

export function runChecklist(root = process.cwd()) {
  const hasExtension = extension => SENSOR_ADAPTERS.some(adapter => adapter.extensions.includes(extension));
  const adapters = SENSOR_ADAPTERS.map(adapter => ({ id: adapter.id, mode: adapter.mode, ...(adapter.filenames ? { filenames: [...adapter.filenames] } : {}), extensions: [...adapter.extensions], status: 'PASS' }));
  const checks = [
    check('adapter-registry', SENSOR_ADAPTERS.length > 0, `${SENSOR_ADAPTERS.length} adapters`),
    check('rust', hasExtension('.rs'), 'Rust'),
    check('ruby-rails', hasExtension('.rb') && hasExtension('.erb') && hasExtension('.haml') && hasExtension('.slim'), 'Ruby / Rails templates'),
    check('template-families', hasExtension('.heex') && SENSOR_ADAPTERS.some(adapter => adapter.id === 'template'), 'Phoenix / Blade / common templates'),
    check('toml', hasExtension('.toml'), 'TOML'),
    check('common-config', ['.json', '.yaml', '.yml', '.xml'].every(hasExtension), 'JSON/YAML/XML'),
    check('bounded-module-scope', SENSOR_COVERAGE.moduleScope === 'explicit-paths' && SENSOR_COVERAGE.packageResolution === 'disabled' && !SENSOR_COVERAGE.wholeProgramAnalysis, SENSOR_COVERAGE.moduleScope),
    check('runtime-rate-limit', SENSOR_COVERAGE.rateLimitRuntimeProof === false, 'heuristic only'),
    check('rules', existsSync(resolve(root, '.project/sensor-rules.json')), '.project/sensor-rules.json'),
    check('architecture', existsSync(resolve(root, 'docs/architecture/src/blueprint.architecture.json')), 'Archify source'),
    check('tests', existsSync(resolve(root, 'tests/sensor.test.mjs')) && existsSync(resolve(root, 'tests/post-tool-sensor.test.mjs')), 'unit + hook integration'),
  ];
  return { schemaVersion: 1, status: checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', adapters, checks };
}

export function formatChecklist(result) { return ['Sensor checklist', ...result.checks.map(item => `[${item.status}] ${item.name}: ${item.detail}`), `Result: ${result.status}`].join('\n'); }
function check(name, passed, detail) { return { name, status: passed ? 'PASS' : 'FAIL', detail }; }
