import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
import { readProgress, validatePlan, approvePlan, progressStatus, progressNext, updateProgressStep, setProgressMode } from './progress-core.mjs';

export const PROGRESS_TOOL_NAMES = Object.freeze(['progress_read', 'progress_status', 'progress_validate_plan', 'progress_approve_plan', 'progress_update_step', 'progress_next', 'progress_set_mode']);
const planSchema = z.object({ goalId: z.string(), title: z.string(), status: z.string().optional(), steps: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().optional(), acceptance: z.array(z.string()), files: z.array(z.string()), commands: z.array(z.string()), evidence: z.array(z.string()).optional() })), validationEvidence: z.array(z.string()).optional(), evidence: z.array(z.string()).optional(), approved: z.boolean().optional() });
const goalIdSchema = z.object({ goalId: z.string() });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
export function createProgressServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-progress', version: '1.0.0' });
  server.registerTool('progress_read', { description: 'Read the persistent progress checklist.', inputSchema: z.object({}) }, async () => result(await readProgress(root)));
  server.registerTool('progress_status', { description: 'Return a compact progress summary.', inputSchema: z.object({}) }, async () => result(progressStatus(await readProgress(root))));
  server.registerTool('progress_validate_plan', { description: 'Validate a plan without writing files.', inputSchema: planSchema }, async plan => result(validatePlan(plan, await readProgress(root))));
  server.registerTool('progress_approve_plan', { description: 'Validate and materialize a plan; approved must be true.', inputSchema: planSchema.extend({ approved: z.literal(true) }) }, async plan => result({ ok: true, progress: await approvePlan(plan, root) }));
  server.registerTool('progress_update_step', { description: 'Update one mutable step status and its short evidence.', inputSchema: z.object({ goalId: z.string(), stepId: z.string(), status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']), evidence: z.array(z.string()).optional() }) }, async input => result({ ok: true, progress: await updateProgressStep(input, root) }));
  server.registerTool('progress_next', { description: 'Return at most three next steps for a goal.', inputSchema: goalIdSchema }, async ({ goalId }) => result(progressNext(await readProgress(root), goalId)));
  server.registerTool('progress_set_mode', { description: 'Set the goal execution mode. Autonomous requires explicit user confirmation.', inputSchema: z.object({ goalId: z.string(), mode: z.enum(['collaborative', 'autonomous']), userConfirmed: z.boolean() }) }, async ({ goalId, mode, userConfirmed }) => result({ ok: true, progress: await setProgressMode(goalId, mode, userConfirmed, root), next: progressNext(await readProgress(root), goalId) }));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { serveStdio(() => createProgressServer()); }
