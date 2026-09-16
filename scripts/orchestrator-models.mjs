import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { loadOrchestratorConfig } from './orchestrator-core.mjs';

const EXECUTABLES = Object.freeze({ codex: 'codex', claude: 'claude', gemini: 'gemini', fixture: process.execPath });

export async function modelCatalog(root = process.cwd(), environment = process.env) {
  const config = await loadOrchestratorConfig(root);
  const configured = config.modelRouting?.catalog ?? [];
  const availability = Object.fromEntries(await Promise.all(['codex', 'claude', 'gemini'].map(async adapter => [adapter, await executableAvailable(EXECUTABLES[adapter], environment)])));
  availability.fixture = environment.CTXROUTE_WORKER_RUNTIME === 'fixture';
  const catalog = configured.map(model => ({ ...model, status: availability[model.adapter] ? (model.status === 'degraded' ? 'degraded' : 'available') : 'unavailable' }));
  if (availability.fixture && !catalog.some(model => model.adapter === 'fixture')) catalog.push(fixtureDescriptor());
  catalog.forEach(model => assertOrchestratorContract('model-descriptor', model));
  return catalog;
}

export async function orchestratorModels(root = process.cwd(), environment = process.env) {
  const catalog = await modelCatalog(root, environment);
  return { mode: (await loadOrchestratorConfig(root)).modelRouting?.mode ?? 'legacy', checked_at: new Date().toISOString(), models: catalog };
}

export function fixtureDescriptor() {
  return { adapter: 'fixture', model_id: 'fixture-model', provider_family: 'fixture', level: 'critical', capabilities: ['code', 'reasoning', 'long-context', 'structured-output', 'web-research'], context_class: 'xlarge', cost_class: 'free', efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], access_modes: ['read-only', 'workspace-write'], status: 'available', verified_at: '2026-09-16T00:00:00Z', verification_source: null, evaluation_score: 1 };
}

async function executableAvailable(name, environment) {
  if (name.includes('/') || name.includes('\\')) return false;
  for (const directory of String(environment.PATH ?? '').split(delimiter).filter(Boolean)) {
    try { await access(resolve(directory, process.platform === 'win32' ? `${name}.exe` : name), constants.X_OK); return true; } catch { /* Continue probing the closed PATH. */ }
  }
  return false;
}
