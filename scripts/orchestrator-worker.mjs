import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, open, rename, unlink } from 'node:fs/promises';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNoSecrets, loadOrchestratorConfig, safeRelativePath } from './orchestrator-core.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

const RUNTIMES = new Set(['auto', 'codex', 'claude', 'fixture']);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const CONTRACT_FILES = Object.freeze({
  'goal-plan': '.project/schemas/orchestrator/goal-plan.schema.json',
  'worker-report': '.project/schemas/orchestrator/worker-report.schema.json',
  'audit-report': '.project/schemas/orchestrator/audit-report.schema.json',
  'goal-acceptance-report': '.project/schemas/orchestrator/goal-acceptance-report.schema.json',
});

export async function workerRuntimeHealth(root = process.cwd(), environment = process.env) {
  const config = await loadOrchestratorConfig(root);
  const requested = environment.CTXROUTE_WORKER_RUNTIME ?? config.workerRuntime ?? 'auto';
  if (!RUNTIMES.has(requested)) return { requested, selected: null, available: false, codex: await executableAvailable('codex', environment), claude: await executableAvailable('claude', environment), cause: 'INVALID_RUNTIME' };
  const codex = await executableAvailable('codex', environment);
  const claude = await executableAvailable('claude', environment);
  const selected = selectRuntime(requested, environment, { codex, claude });
  return { requested, selected, available: Boolean(selected), codex, claude, cause: selected ? null : 'NO_WORKER_RUNTIME' };
}

export async function dispatchWorker({ dispatch_id, phase, mission, skill_path, output_contract, worktree }, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (!safeRelativePath(skill_path) || !CONTRACT_FILES[output_contract]) throw categorized('INVALID_DISPATCH', 'worker dispatch paths or output contract are invalid');
  const config = await loadOrchestratorConfig(root);
  const health = await workerRuntimeHealth(root, environment);
  const runtime = dependencies.runtime ?? health.selected;
  if (!runtime || !RUNTIMES.has(runtime) || runtime === 'auto') throw categorized('WORKER_UNAVAILABLE', `worker runtime is unavailable: ${health.cause ?? 'unknown'}`);
  const dispatch = { dispatch_id, runtime, phase, mission, skill_path, output_contract };
  assertNoSecrets(dispatch);
  assertOrchestratorContract('worker-dispatch', dispatch);
  const cwd = resolve(root, worktree ?? '.');
  const contractPath = resolve(root, CONTRACT_FILES[output_contract]);
  const prompt = workerPrompt(dispatch);
  const command = await workerCommand(runtime, phase, cwd, contractPath, prompt, root, environment);
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
  if (outcome.code !== 0) throw categorized('WORKER_CRASH', `worker exited ${outcome.code}: ${redact(outcome.stderr).slice(0, 512)}`);
  const value = parseRuntimeOutput(runtime, outcome.stdout, command.outputPath);
  assertNoSecrets(value);
  assertOrchestratorContract(output_contract, value);
  const reportPath = `.ctxroute/reports/${dispatch_id}.json`;
  await atomicReport(resolve(root, reportPath), value, config.reportBytes, dependencies);
  return { runtime, report: value, report_path: reportPath, duration_ms: Date.now() - started, stderr: redact(outcome.stderr).slice(0, 512) || null };
}

export function buildWorkerCommand(runtime, phase, cwd, contractPath, prompt, root = process.cwd()) {
  const readOnly = phase !== 'work';
  if (runtime === 'codex') {
    const outputPath = resolve(root, `.ctxroute/reports/.codex-${process.pid}-${Date.now()}.json`);
    return { executable: 'codex', args: ['exec', '--sandbox', readOnly ? 'read-only' : 'workspace-write', '-c', 'approval_policy="never"', '--ephemeral', '--output-schema', contractPath, '--output-last-message', outputPath, '--cd', cwd, prompt], outputPath };
  }
  if (runtime === 'claude') {
    const schema = JSON.stringify(JSON.parse(requireRead(contractPath)));
    const tools = readOnly ? 'Read,Grep,Glob' : 'Read,Edit,Write,Bash';
    return { executable: 'claude', args: ['--print', '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'json', '--json-schema', schema, '--tools', tools, prompt], outputPath: null };
  }
  if (runtime === 'fixture') return { executable: process.execPath, args: [resolve(moduleDirectory, 'orchestrator-fixture-worker.mjs'), phase], outputPath: null, stdin: '' };
  throw categorized('INVALID_RUNTIME', `unsupported worker runtime: ${runtime}`);
}

function selectRuntime(requested, environment, available) {
  if (requested === 'fixture') return 'fixture';
  if (requested === 'codex' || requested === 'claude') return available[requested] ? requested : null;
  if (environment.CTXROUTE_AGENT_HOST === 'codex' && available.codex) return 'codex';
  if (environment.CTXROUTE_AGENT_HOST === 'claude' && available.claude) return 'claude';
  if (environment.CODEX_THREAD_ID && available.codex) return 'codex';
  if (environment.CLAUDECODE && available.claude) return 'claude';
  return available.codex ? 'codex' : available.claude ? 'claude' : null;
}

async function workerCommand(runtime, phase, cwd, contractPath, prompt, root, environment) {
  const command = buildWorkerCommand(runtime, phase, cwd, contractPath, prompt, root);
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
  if (runtime !== 'claude') return parsed;
  if (parsed.structured_output && parsed.structured_output === Object(parsed.structured_output)) return parsed.structured_output;
  if (parsed.result === String(parsed.result)) return JSON.parse(parsed.result);
  return parsed;
}

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
