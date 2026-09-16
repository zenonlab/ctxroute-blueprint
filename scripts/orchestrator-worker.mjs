import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, unlink } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSecrets, loadOrchestratorConfig, safeRelativePath } from './orchestrator-core.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

const RUNTIMES = new Set(['auto', 'codex', 'claude', 'gemini', 'fixture']);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILES = Object.freeze({
  'goal-plan': '.project/schemas/orchestrator/goal-plan.schema.json',
  'worker-report': '.project/schemas/orchestrator/worker-report.schema.json',
  'audit-report': '.project/schemas/orchestrator/audit-report.schema.json',
  'goal-acceptance-report': '.project/schemas/orchestrator/goal-acceptance-report.schema.json',
  'documentation-evidence-report': '.project/schemas/orchestrator/documentation-evidence-report.schema.json',
});

export async function workerRuntimeHealth(root = process.cwd(), environment = process.env) {
  const config = await loadOrchestratorConfig(root);
  const requested = environment.CTXROUTE_WORKER_RUNTIME ?? config.workerRuntime ?? 'auto';
  if (!RUNTIMES.has(requested)) return { requested, selected: null, available: false, codex: await executableAvailable('codex', environment), claude: await executableAvailable('claude', environment), gemini: await executableAvailable('gemini', environment), cause: 'INVALID_RUNTIME' };
  const codex = await executableAvailable('codex', environment);
  const claude = await executableAvailable('claude', environment);
  const gemini = await executableAvailable('gemini', environment);
  const selected = selectRuntime(requested, environment, { codex, claude, gemini });
  return { requested, selected, available: Boolean(selected), codex, claude, gemini, cause: selected ? null : 'NO_WORKER_RUNTIME' };
}

export async function dispatchWorker({ dispatch_id, phase, mission, skill_path, output_contract, worktree, routing = null }, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (!safeRelativePath(skill_path) || !CONTRACT_FILES[output_contract]) throw categorized('INVALID_DISPATCH', 'worker dispatch paths or output contract are invalid');
  const config = await loadOrchestratorConfig(root);
  const health = await workerRuntimeHealth(root, environment);
  const runtime = dependencies.runtime ?? routing?.selected?.adapter ?? health.selected;
  if (!runtime || !RUNTIMES.has(runtime) || runtime === 'auto') throw categorized('WORKER_UNAVAILABLE', `worker runtime is unavailable: ${health.cause ?? 'unknown'}`);
  const dispatch = { dispatch_id, runtime, phase, mission, skill_path, output_contract };
  if (routing) dispatch.routing = routing;
  assertNoSecrets(dispatch);
  assertOrchestratorContract('worker-dispatch', dispatch);
  const cwd = resolve(root, worktree ?? '.');
  const contractPath = resolve(root, CONTRACT_FILES[output_contract]);
  const prompt = workerPrompt(dispatch);
  const command = await workerCommand(runtime, phase, cwd, contractPath, prompt, root, environment, routing);
  const started = Date.now();
  const outcome = await runBounded(command, {
    cwd,
    environment: workerEnvironment(environment, mission, skill_path),
    timeout: config.workerTimeoutMs,
    stdoutBytes: config.workerStdoutBytes,
    stderrBytes: config.workerStderrBytes,
    spawn: dependencies.spawn ?? spawn,
  });
  if (outcome.timed_out) throw categorized('WORKER_TIMEOUT', 'worker exceeded its configured timeout');
  if (outcome.code !== 0) throw categorized(classifyProviderFailure(outcome.stderr), `worker exited ${outcome.code}: ${redact(outcome.stderr).slice(0, 512)}`);
  let value = parseRuntimeOutput(runtime, outcome.stdout, command.outputPath);
  const duration = Date.now() - started;
  const usage = extractUsage(runtime, outcome.stdout);
  if (output_contract === 'worker-report' && routing?.selected) {
    value = { ...value, documentation_sources_used: value.documentation_sources_used ?? [], confidence: value.confidence ?? 'medium', unverified_points: value.unverified_points ?? [], consumption: { receipt_id: `${dispatch_id}-receipt`, dispatch_id, adapter: runtime, model_id: routing.selected.model_id, provider_family: routing.selected.provider_family, effort: routing.effort, duration_ms: duration, normalized_units: 1, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: usage.cost_usd, outcome: 'success', cause: null }, observed_model: routing.selected.model_id, observed_runtime: runtime };
  }
  assertNoSecrets(value);
  assertOrchestratorContract(output_contract, value);
  const reportPath = `.ctxroute/reports/${dispatch_id}.json`;
  await atomicReport(resolve(root, reportPath), value, config.reportBytes, dependencies);
  return { runtime, model_id: routing?.selected?.model_id ?? 'runtime-default', provider_family: routing?.selected?.provider_family ?? runtime, effort: routing?.effort ?? 'none', report: value, report_path: reportPath, duration_ms: duration, usage, stderr: redact(outcome.stderr).slice(0, 512) || null };
}

export function buildWorkerCommand(runtime, phase, cwd, contractPath, prompt, root = process.cwd(), routing = null, options = {}) {
  const readOnly = phase !== 'work';
  if (runtime === 'codex') {
    const outputPath = resolve(root, `.ctxroute/reports/.codex-${process.pid}-${Date.now()}.json`);
    const args = ['exec', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"', '--ephemeral'];
    if (routing?.selected?.model_id) args.push('--model', routing.selected.model_id);
    if (routing?.effort && routing.effort !== 'none') args.push('-c', `model_reasoning_effort="${routing.effort}"`);
    if (phase === 'research') args.push('--search');
    args.push('--output-schema', contractPath, '--output-last-message', outputPath, '--cd', cwd, prompt);
    return { executable: 'codex', args, outputPath };
  }
  if (runtime === 'claude') {
    const schema = JSON.stringify(JSON.parse(requireRead(contractPath)));
    const tools = phase === 'research' ? 'WebSearch,WebFetch,Read,Grep,Glob' : readOnly ? 'Read,Grep,Glob' : 'Read,Edit,Write,Bash';
    const args = ['--print', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'json', '--json-schema', schema, '--tools', tools];
    if (routing?.selected?.model_id) args.push('--model', routing.selected.model_id);
    if (routing?.effort && routing.effort !== 'none') args.push('--effort', routing.effort);
    if (options.max_cost_usd !== null && options.max_cost_usd !== undefined) args.push('--max-budget-usd', String(options.max_cost_usd));
    if (options.fallback_model) args.push('--fallback-model', options.fallback_model);
    args.push(prompt);
    return { executable: 'claude', args, outputPath: null };
  }
  if (runtime === 'gemini') {
    const args = ['--prompt', prompt, '--output-format', 'json', '--sandbox', '-e', 'none'];
    if (routing?.selected?.model_id) args.push('--model', routing.selected.model_id);
    if (!readOnly) args.push('--approval-mode', 'auto_edit');
    return { executable: 'gemini', args, outputPath: null };
  }
  if (runtime === 'fixture') return { executable: process.execPath, args: [resolve(moduleDirectory, 'orchestrator-fixture-worker.mjs'), phase], outputPath: null, stdin: '' };
  throw categorized('INVALID_RUNTIME', `unsupported worker runtime: ${runtime}`);
}

function selectRuntime(requested, environment, available) {
  if (requested === 'fixture') return 'fixture';
  if (requested === 'codex' || requested === 'claude' || requested === 'gemini') return available[requested] ? requested : null;
  if (environment.CTXROUTE_AGENT_HOST === 'codex' && available.codex) return 'codex';
  if (environment.CTXROUTE_AGENT_HOST === 'claude' && available.claude) return 'claude';
  if (environment.CODEX_THREAD_ID && available.codex) return 'codex';
  if (environment.CLAUDECODE && available.claude) return 'claude';
  return available.codex ? 'codex' : available.claude ? 'claude' : available.gemini ? 'gemini' : null;
}

async function workerCommand(runtime, phase, cwd, contractPath, prompt, root, environment, routing) {
  const command = buildWorkerCommand(runtime, phase, cwd, contractPath, prompt, root, routing);
  if (runtime === 'fixture') command.stdin = JSON.stringify({ phase, dispatch: JSON.parse(prompt.slice(prompt.indexOf('{'))) });
  if (runtime !== 'fixture' && !await executableAvailable(command.executable, environment)) throw categorized('WORKER_UNAVAILABLE', `${runtime} executable is unavailable`);
  return command;
}

function workerPrompt(dispatch) {
  return [
    `Read ${dispatch.skill_path} completely before acting.`,
    'Use only the bounded mission below; no conversation history is available.',
    'Do not commit, change worktree HEAD, or mutate orchestrator state.',
    `Return only JSON matching ${dispatch.output_contract}.`,
    JSON.stringify(dispatch.mission),
  ].join('\n');
}

function workerEnvironment(environment, mission, skillPath) {
  return {
    ...environment,
    CTXROUTE_AGENT_ROLE: 'worker',
    CTXROUTE_MISSION_ID: mission?.mission_id ?? mission?.goal_id ?? 'system',
    CTXROUTE_SKILL_PATH: skillPath,
  };
}

async function runBounded(command, options) {
  return new Promise((resolveRun, reject) => {
    const child = options.spawn(command.executable, command.args, { cwd: options.cwd, env: options.environment, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let exceeded = false; let timedOut = false;
    const append = (current, chunk, maximum) => { const next = Buffer.concat([current, Buffer.from(chunk)]); if (next.length > maximum) { exceeded = true; return next.subarray(0, maximum); } return next; };
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk, options.stdoutBytes); if (exceeded) child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk, options.stderrBytes); if (exceeded) child.kill('SIGTERM'); });
    child.on('error', reject);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, options.timeout);
    child.on('close', code => { clearTimeout(timer); resolveRun({ code: exceeded ? 1 : code, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), timed_out: timedOut }); });
    child.stdin.end(command.stdin ?? '');
  });
}

function parseRuntimeOutput(runtime, stdout, outputPath) {
  let source = stdout.trim();
  if (runtime === 'codex') {
    source = requireRead(outputPath);
    unlink(outputPath).catch(() => {});
  }
  const parsed = JSON.parse(source);
  if (runtime === 'gemini') return parsed.response === String(parsed.response) ? JSON.parse(parsed.response) : parsed.response;
  if (runtime !== 'claude') return parsed;
  if (parsed.structured_output && parsed.structured_output === Object(parsed.structured_output)) return parsed.structured_output;
  if (parsed.result === String(parsed.result)) return JSON.parse(parsed.result);
  return parsed;
}

export function extractUsage(runtime, stdout) {
  if (runtime !== 'gemini') return { input_tokens: null, output_tokens: null, total_tokens: null, tool_calls: null, cost_usd: null };
  try {
    const parsed = JSON.parse(stdout);
    const models = Object.values(parsed.stats?.models ?? {});
    return { input_tokens: sum(models, 'prompt'), output_tokens: sum(models, 'candidates'), total_tokens: sum(models, 'total'), tool_calls: parsed.stats?.tools?.totalCalls ?? null, cost_usd: null };
  } catch { return { input_tokens: null, output_tokens: null, total_tokens: null, tool_calls: null, cost_usd: null }; }
}

export function classifyProviderFailure(output) {
  const value = String(output).toLocaleLowerCase('en-US');
  if (/auth|unauthori|credential|login/u.test(value)) return 'PROVIDER_AUTH';
  if (/quota|rate.?limit|resource exhausted/u.test(value)) return 'PROVIDER_QUOTA';
  if (/unknown model|model not found|invalid model/u.test(value)) return 'PROVIDER_MODEL_UNKNOWN';
  if (/timeout|timed out/u.test(value)) return 'PROVIDER_TIMEOUT';
  return 'WORKER_CRASH';
}

export function providerAdapter(name) {
  if (!['codex', 'claude', 'gemini', 'fixture'].includes(name)) throw categorized('INVALID_RUNTIME', `unsupported worker runtime: ${name}`);
  return Object.freeze({
    name,
    probe: async environment => name === 'fixture' || executableAvailable(name, environment ?? process.env),
    capabilities: () => ({ adapter: name, capabilities: name === 'fixture' ? ['code', 'reasoning', 'long-context', 'structured-output', 'web-research'] : ['code', 'reasoning', 'structured-output', 'web-research'], context_classes: ['small', 'medium', 'large', 'xlarge'], efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], access_modes: ['read-only', 'workspace-write'], web_access: true }),
    buildCommand: input => buildWorkerCommand(name, input.phase, input.cwd, input.contractPath, input.prompt, input.root, input.routing, input.options),
    parseOutput: (stdout, artifact) => parseRuntimeOutput(name, stdout, artifact),
    extractUsage: stdout => extractUsage(name, stdout),
    classifyFailure: output => classifyProviderFailure(output),
    redactDiagnostics: output => redact(output).slice(0, 512),
  });
}

function sum(models, field) { const values = models.map(model => model.tokens?.[field]).filter(Number.isFinite); return values.length ? values.reduce((total, value) => total + value, 0) : null; }

async function atomicReport(path, value, maximumBytes, dependencies) {
  const source = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(source) > maximumBytes) throw categorized('REPORT_TOO_LARGE', 'worker report exceeds its byte budget');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${dependencies.id?.() ?? Date.now()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(source, 'utf8'); await handle.sync(); } catch (error) { await unlink(temporary).catch(() => {}); throw error; } finally { await handle.close(); }
  await rename(temporary, path);
}

async function executableAvailable(name, environment) {
  if (name.includes('/') || name.includes('\\')) return false;
  for (const directory of String(environment.PATH ?? '').split(delimiter).filter(Boolean)) {
    try { await access(resolve(directory, process.platform === 'win32' ? `${name}.exe` : name), constants.X_OK); return true; } catch { /* keep searching */ }
  }
  return false;
}

function requireRead(path) { return globalThis.process.getBuiltinModule('fs').readFileSync(path, 'utf8'); }
function redact(value) { return String(value ?? '').replace(/(?:bearer\s+\S+|(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)\s*[:=]\s*\S+)/giu, '<redacted>'); }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
