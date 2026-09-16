import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
import { bootstrapOrchestrator } from './orchestrator-bootstrap.mjs';
import { contextQuery, explainExecution, listOperatingModes, mutateCoordination, pendingDecisions, prepareMission, promoteExperiment, readCoordination, resolveDecision, setOperatingMode, submitWorkerReport } from './orchestrator-service.mjs';

export const ORCHESTRATOR_TOOL_NAMES = Object.freeze(['ctxroute_context_query', 'orchestrator_health', 'orchestrator_read', 'orchestrator_mutate', 'orchestrator_prepare_mission', 'orchestrator_submit_worker_report', 'orchestrator_modes', 'orchestrator_set_mode', 'orchestrator_explain_execution', 'orchestrator_pending_decisions', 'orchestrator_resolve_decision', 'orchestrator_promote_experiment']);
const transactionSchema = z.object({ operation_id: z.string(), expected_revision: z.number().int().nonnegative(), action: z.string(), payload: z.record(z.string(), z.unknown()).optional() });
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export function createOrchestratorServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-orchestrator', version: '2.0.0' });
  server.registerTool('orchestrator_health', { description: 'Bootstrap and report fail-closed orchestrator health and permitted recovery actions.', inputSchema: z.object({}) }, async () => response(await bootstrapOrchestrator(root)));
  server.registerTool('orchestrator_read', { description: 'Read mode, goals, missions, reports, and revision without mutation.', inputSchema: z.object({}) }, async () => response(await readCoordination(root)));
  server.registerTool('orchestrator_mutate', { description: 'Apply an idempotent orchestrator-owned mode, goal, mission, or audit transaction.', inputSchema: transactionSchema }, async input => response(await mutateCoordination(input, root)));
  server.registerTool('orchestrator_prepare_mission', { description: 'Create a minimal SWARM_ON mission and isolated worktree; SWARM_OFF bypasses both.', inputSchema: transactionSchema }, async input => response(await prepareMission(input, root)));
  server.registerTool('orchestrator_submit_worker_report', { description: 'Validate a bounded worker report and actual worktree file scope, then record it.', inputSchema: transactionSchema }, async input => response(await submitWorkerReport(input, root)));
  server.registerTool('orchestrator_modes', { description: 'List canonical operating modes and declarative workflows.', inputSchema: z.object({}) }, async () => response(listOperatingModes()));
  server.registerTool('orchestrator_set_mode', { description: 'Persist the operating mode used by new goals. Active goals retain their frozen policy digest.', inputSchema: z.object({ mode: z.enum(['SWARM', 'AUTO', 'SOLO', 'GUARDED', 'DIRECT']), operation_id: z.string(), expected_revision: z.number().int().nonnegative().optional() }) }, async input => response(await setOperatingMode(input, root)));
  server.registerTool('orchestrator_explain_execution', { description: 'Resolve and explain execution policy without mutation.', inputSchema: z.object({ goal_id: z.string().optional(), requested_mode: z.string().optional(), workflow: z.string().optional(), capabilities: z.array(z.string()).optional(), require_write: z.boolean().optional(), require_isolation: z.boolean().optional() }) }, async input => response(await explainExecution(input, root)));
  server.registerTool('orchestrator_pending_decisions', { description: 'List durable pending human decisions and their bounded checkpoints.', inputSchema: z.object({}) }, async () => response(await pendingDecisions(root)));
  server.registerTool('orchestrator_resolve_decision', { description: 'Validate a DecisionReceipt against the frozen policy and resume at the checkpoint.', inputSchema: z.object({ operation_id: z.string(), expected_revision: z.number().int().nonnegative().optional(), receipt: z.record(z.string(), z.unknown()) }) }, async input => response(await resolveDecision(input, root)));
  server.registerTool('orchestrator_promote_experiment', { description: 'Promote a READY_FOR_PROMOTION experiment after an explicit decision receipt.', inputSchema: z.object({ operation_id: z.string(), expected_revision: z.number().int().nonnegative().optional(), goal_id: z.string(), decision_receipt_id: z.string() }) }, async input => response(await promoteExperiment(input, root)));
  server.registerTool('ctxroute_context_query', { description: 'Resolve bounded CTXRoute references on demand without injecting global history.', inputSchema: z.object({ paths: z.array(z.string()), tool: z.string().optional(), session_id: z.string().optional() }) }, async input => response(await contextQuery(input, root)));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await bootstrapOrchestrator();
  serveStdio(() => createOrchestratorServer());
}
