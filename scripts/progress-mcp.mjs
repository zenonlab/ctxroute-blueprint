import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { readProgress, validatePlan, approvePlan, progressStatus } from './progress-core.mjs';

const planSchema = z.object({ goalId: z.string(), title: z.string(), status: z.string().optional(), steps: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().optional(), acceptance: z.array(z.string()), files: z.array(z.string()), commands: z.array(z.string()), evidence: z.array(z.string()).optional() })), validationEvidence: z.array(z.string()).optional(), evidence: z.array(z.string()).optional(), approved: z.boolean().optional() });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
export function createProgressServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-progress', version: '1.0.0' });
  server.registerTool('progress_read', { description: 'Read the persistent progress checklist.', inputSchema: z.object({}) }, async () => result(await readProgress(root)));
  server.registerTool('progress_status', { description: 'Return a compact progress summary.', inputSchema: z.object({}) }, async () => result(progressStatus(await readProgress(root))));
  server.registerTool('progress_validate_plan', { description: 'Validate a plan without writing files.', inputSchema: planSchema }, async plan => result(validatePlan(plan, await readProgress(root))));
  server.registerTool('progress_approve_plan', { description: 'Validate and materialize a plan; approved must be true.', inputSchema: planSchema.extend({ approved: z.literal(true) }) }, async plan => result({ ok: true, progress: await approvePlan(plan, root) }));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) { serveStdio(() => createProgressServer()); }
