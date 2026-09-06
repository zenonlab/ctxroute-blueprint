import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
import { contextQuery, mutateCoordination, prepareMission, readCoordination, submitWorkerReport } from './orchestrator-service.mjs';

export const ORCHESTRATOR_TOOL_NAMES = Object.freeze(['ctxroute_context_query', 'orchestrator_read', 'orchestrator_mutate', 'orchestrator_prepare_mission', 'orchestrator_submit_worker_report']);
const transactionSchema = z.object({ operation_id: z.string(), expected_revision: z.number().int().nonnegative(), action: z.string(), payload: z.record(z.string(), z.unknown()).optional() });
const response = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export function createOrchestratorServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-orchestrator', version: '1.0.0' });
  server.registerTool('orchestrator_read', { description: 'Read mode, goals, missions, reports, and revision without mutation.', inputSchema: z.object({}) }, async () => response(await readCoordination(root)));
  server.registerTool('orchestrator_mutate', { description: 'Apply an idempotent orchestrator-owned mode, goal, mission, or audit transaction.', inputSchema: transactionSchema }, async input => response(await mutateCoordination(input, root)));
  server.registerTool('orchestrator_prepare_mission', { description: 'Create a minimal SWARM_ON mission and isolated worktree; SWARM_OFF bypasses both.', inputSchema: transactionSchema }, async input => response(await prepareMission(input, root)));
  server.registerTool('orchestrator_submit_worker_report', { description: 'Validate a bounded worker report and actual worktree file scope, then record it.', inputSchema: transactionSchema }, async input => response(await submitWorkerReport(input, root)));
  server.registerTool('ctxroute_context_query', { description: 'Resolve bounded CTXRoute references on demand without injecting global history.', inputSchema: z.object({ paths: z.array(z.string()), tool: z.string().optional(), session_id: z.string().optional() }) }, async input => response(await contextQuery(input, root)));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) serveStdio(() => createOrchestratorServer());
