import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
import { bootstrapOrchestrator } from './orchestrator-bootstrap.mjs';
import { contextQuery, mutateCoordination, prepareMission, readCoordination, submitWorkerReport } from './orchestrator-service.mjs';
import { runGoal } from './orchestrator-goal.mjs';
import { workerRuntimeHealth } from './orchestrator-worker.mjs';
import { explainOrchestratorRoute, orchestratorModelEvaluations, orchestratorModels, orchestratorUsage, refreshOrchestratorDocumentation } from './orchestrator-routing-service.mjs';

export const ORCHESTRATOR_TOOL_NAMES = Object.freeze(['ctxroute_context_query', 'orchestrator_health', 'orchestrator_read', 'orchestrator_mutate', 'orchestrator_prepare_mission', 'orchestrator_run_goal', 'orchestrator_submit_worker_report', 'orchestrator_models', 'orchestrator_explain_route', 'orchestrator_usage', 'orchestrator_refresh_documentation', 'orchestrator_model_evaluations']);
const transactionSchema = z.object({ operation_id: z.string(), expected_revision: z.number().int().nonnegative(), action: z.string(), payload: z.record(z.string(), z.unknown()).optional() });
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export function createOrchestratorServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-orchestrator', version: '2.0.0' });
  server.registerTool('orchestrator_health', { description: 'Bootstrap and report fail-closed orchestrator health, local worker availability, and recoverable missions.', inputSchema: z.object({}) }, async () => {
    const bootstrap = await bootstrapOrchestrator(root);
    const state = await readCoordination(root);
    const models = await orchestratorModels(root);
    const families = new Set(models.models.filter(model => model.status === 'available').map(model => model.provider_family));
    return response({ ...bootstrap, worker: await workerRuntimeHealth(root), adapters: [...new Set(models.models.map(model => model.adapter))], models: models.models, catalog_checked_at: models.checked_at, web_capable_adapters: [...new Set(models.models.filter(model => model.status === 'available' && model.capabilities.includes('web-research')).map(model => model.adapter))], independent_auditor_available: families.size > 1, blocked_by_documentation: state.goals.filter(goal => goal.blocked_cause === 'FRESH_DOCUMENTATION_UNAVAILABLE').length, blocked_by_capability: state.goals.filter(goal => ['CAPABILITY_UNAVAILABLE', 'INDEPENDENT_AUDITOR_UNAVAILABLE'].includes(goal.blocked_cause)).length, recoverable_missions: state.goals.flatMap(goal => goal.missions.filter(mission => ['BLOCKED', 'NEEDS_ATTENTION', 'WAITING_FOR_SKILL'].includes(mission.status)).map(mission => ({ goal_id: goal.goal_id, mission_id: mission.mission_id, status: mission.status, cause: mission.blocking_cause ?? null }))) });
  });
  server.registerTool('orchestrator_read', { description: 'Read mode, goals, missions, reports, and revision without mutation.', inputSchema: z.object({}) }, async () => response(await readCoordination(root)));
  server.registerTool('orchestrator_mutate', { description: 'Apply an idempotent orchestrator-owned mode, goal, mission, or audit transaction.', inputSchema: transactionSchema }, async input => response(await mutateCoordination(input, root)));
  server.registerTool('orchestrator_prepare_mission', { description: 'Create a minimal SWARM_ON mission and isolated worktree; SWARM_OFF bypasses both.', inputSchema: transactionSchema }, async input => response(await prepareMission(input, root)));
  const goalInput = z.object({ goal_id: z.string(), title: z.string(), objective: z.string(), acceptance_criteria: z.array(z.string()), suggested_paths: z.array(z.string()), expected_revision: z.number().int().nonnegative(), importance: z.enum(['low', 'normal', 'high', 'critical']).optional(), change_kind: z.enum(['routine', 'feature', 'bugfix', 'security', 'migration', 'incident', 'audit']).optional(), consumption: z.record(z.string(), z.unknown()).optional() }).strict();
  server.registerTool('orchestrator_run_goal', { description: 'Research, route, plan, dispatch, validate, integrate, independently audit, and close one bounded goal.', inputSchema: goalInput }, async input => response(await runGoal(input, root)));
  server.registerTool('orchestrator_submit_worker_report', { description: 'Validate a bounded worker report and actual worktree file scope, then record it.', inputSchema: transactionSchema }, async input => response(await submitWorkerReport(input, root)));
  server.registerTool('ctxroute_context_query', { description: 'Resolve bounded CTXRoute references on demand without injecting global history.', inputSchema: z.object({ paths: z.array(z.string()), tool: z.string().optional(), session_id: z.string().optional() }) }, async input => response(await contextQuery(input, root)));
  server.registerTool('orchestrator_models', { description: 'List the closed model catalog and probed availability without secrets or executable paths.', inputSchema: z.object({}) }, async () => response(await orchestratorModels(root)));
  server.registerTool('orchestrator_explain_route', { description: 'Reproduce the pure routing decision and every rejected alternative.', inputSchema: z.object({ goal_id: z.string(), title: z.string(), objective: z.string(), acceptance_criteria: z.array(z.string()), suggested_paths: z.array(z.string()), phase: z.enum(['research', 'planning', 'work', 'skillCreation', 'skillAudit', 'repair', 'goalAudit', 'conflictAnalysis', 'synthesis']).optional(), importance: z.enum(['low', 'normal', 'high', 'critical']).optional(), change_kind: z.enum(['routine', 'feature', 'bugfix', 'security', 'migration', 'incident', 'audit']).optional(), consumption: z.record(z.string(), z.unknown()).optional() }).passthrough() }, async input => response(await explainOrchestratorRoute(input, root)));
  server.registerTool('orchestrator_usage', { description: 'Report goal consumption, known tokens and cost without fabricating unknown monetary values.', inputSchema: z.object({ goal_id: z.string() }).strict() }, async input => response(await orchestratorUsage(input.goal_id, root)));
  server.registerTool('orchestrator_refresh_documentation', { description: 'Run bounded read-only official documentation research and return a closed freshness receipt.', inputSchema: goalInput }, async input => response(await refreshOrchestratorDocumentation(input, root)));
  server.registerTool('orchestrator_model_evaluations', { description: 'Return bounded local model evaluation aggregates.', inputSchema: z.object({}) }, async () => response(await orchestratorModelEvaluations(root)));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await bootstrapOrchestrator();
  serveStdio(() => createOrchestratorServer());
}
