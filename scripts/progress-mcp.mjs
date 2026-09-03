import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
import { readProgress, validatePlan, approvePlan, progressStatus, progressNext, claimProgressTicket, updateProgressStep, setProgressMode } from './progress-core.mjs';
import { openProgressDashboard } from './progress-dashboard-manager.mjs';

export const PROGRESS_TOOL_NAMES = Object.freeze(['progress_read', 'progress_status', 'progress_validate_plan', 'progress_approve_plan', 'progress_claim_ticket', 'progress_update_step', 'progress_next', 'progress_set_mode', 'progress_open_dashboard']);
const planSchema = z.object({ goalId: z.string(), title: z.string(), status: z.string().optional(), executionMode: z.enum(['automatic', 'manual']).optional(), steps: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().optional(), acceptance: z.array(z.string()), files: z.array(z.string()), commands: z.array(z.string()), evidence: z.array(z.string()).optional() })), validationEvidence: z.array(z.string()).optional(), evidence: z.array(z.string()).optional(), approved: z.boolean().optional() });
const goalIdSchema = z.object({ goalId: z.string() });
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
export function createProgressServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-progress', version: '1.0.0' });
  server.registerTool('progress_read', { description: 'Read the persistent progress checklist.', inputSchema: z.object({}) }, async () => result(await readProgress(root)));
  server.registerTool('progress_status', { description: 'Return a compact progress summary.', inputSchema: z.object({}) }, async () => result(progressStatus(await readProgress(root))));
  server.registerTool('progress_validate_plan', { description: 'Validate a plan without writing files.', inputSchema: planSchema }, async plan => result(validatePlan(plan, await readProgress(root))));
  server.registerTool('progress_approve_plan', { description: 'Validate and materialize an authorized plan. approved: true is the write flag, not a second confirmation.', inputSchema: planSchema.extend({ approved: z.literal(true) }) }, async plan => result({ ok: true, progress: await approvePlan(plan, root) }));
  server.registerTool('progress_claim_ticket', { description: 'Atomically claim one unassigned ticket for an agent. Call once before work.', inputSchema: z.object({ agentId: z.string(), goalId: z.string().optional() }) }, async ({ agentId, goalId }) => result(await claimProgressTicket(agentId, goalId, root)));
  server.registerTool('progress_update_step', { description: 'Report one claimed ticket result after work. Returns a compact acknowledgement.', inputSchema: z.object({ goalId: z.string(), stepId: z.string(), agentId: z.string(), status: z.enum(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']), evidence: z.array(z.string()).optional() }) }, async input => { const progress = await updateProgressStep(input, root); const goal = progress.goals.find(item => item.id === input.goalId); const step = goal.steps.find(item => item.id === input.stepId); return result({ ok: true, goalStatus: goal.status, ticket: { stepId: step.id, status: step.status, assignee: step.assignee, evidence: step.evidence.slice(0, 3) } }); });
  server.registerTool('progress_next', { description: 'Return at most three next steps for a goal.', inputSchema: goalIdSchema }, async ({ goalId }) => result(progressNext(await readProgress(root), goalId)));
  server.registerTool('progress_set_mode', { description: 'Set automatic execution or a manual pause for a visual review or important product/design decision.', inputSchema: z.object({ goalId: z.string(), mode: z.enum(['automatic', 'manual']) }) }, async ({ goalId, mode }) => result({ ok: true, progress: await setProgressMode(goalId, mode, false, root), next: progressNext(await readProgress(root), goalId) }));
  server.registerTool('progress_open_dashboard', { description: 'Start or reuse the authenticated local Progress dashboard without opening a browser.', inputSchema: z.object({}) }, async () => result(await openProgressDashboard(root)));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) { serveStdio(() => createProgressServer()); }
