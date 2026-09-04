import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import * as z from 'zod/v4';
import { MANUAL_REASONS, PROGRESS_RESOURCE_URI, ensureProgressView, readProgress, validatePlan, approvePlan, progressStatus, progressNext, progressMutationResult, claimProgressTicket, updateProgressStep, setProgressMode } from './progress-core.mjs';
import { openProgressDashboard } from './progress-dashboard-manager.mjs';

export const PROGRESS_TOOL_NAMES = Object.freeze(['progress_status', 'progress_validate_plan', 'progress_approve_plan', 'progress_claim_ticket', 'progress_update_step', 'progress_next', 'progress_set_mode', 'progress_open_dashboard']);
const planSchema = z.object({ goalId: z.string(), title: z.string(), status: z.string().optional(), executionMode: z.enum(['automatic', 'manual']).optional(), manualReason: z.enum(MANUAL_REASONS).nullable().optional(), steps: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().optional(), claimable: z.boolean().optional(), acceptance: z.array(z.string()), files: z.array(z.string()).optional(), commands: z.array(z.string()).optional(), evidence: z.array(z.string()).optional() })), validationEvidence: z.array(z.string()).optional(), evidence: z.array(z.string()).optional(), approved: z.boolean().optional() });
const goalIdSchema = z.object({ goalId: z.string() });
const modeSchema = z.discriminatedUnion('mode', [z.object({ goalId: z.string(), mode: z.literal('automatic') }), z.object({ goalId: z.string(), mode: z.literal('manual'), reason: z.enum(MANUAL_REASONS) })]);
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export function createProgressServer(root = process.cwd()) {
  const server = new McpServer({ name: 'ctxroute-progress', version: '1.0.0' });
  const ready = ensureProgressView(root);
  void ready.catch(() => {});
  const afterReady = operation => async (...args) => { await ready; return operation(...args); };
  server.registerResource('progress-full', PROGRESS_RESOURCE_URI, { title: 'Full Progress checklist', description: 'Complete JSON checklist for voluntary diagnostics. Prefer status, next, and claim tools for normal coordination.', mimeType: 'application/json' }, afterReady(async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await readProgress(root)) }] })));
  server.registerTool('progress_status', { description: 'Return a compact progress summary.', inputSchema: z.object({}) }, afterReady(async () => result(progressStatus(await readProgress(root)))));
  server.registerTool('progress_validate_plan', { description: 'Validate a plan without writing files.', inputSchema: planSchema }, afterReady(async plan => { const validation = validatePlan(plan, await readProgress(root)); return result({ ok: validation.ok, errors: validation.errors }); }));
  server.registerTool('progress_approve_plan', { description: 'Validate and materialize an authorized plan. approved: true is the write flag, not a second confirmation. Returns a compact acknowledgement.', inputSchema: planSchema.extend({ approved: z.literal(true) }) }, afterReady(async plan => result(progressMutationResult(await approvePlan(plan, root), plan.goalId ?? plan.id))));
  server.registerTool('progress_claim_ticket', { description: 'Explicitly claim one unassigned milestone for parallel coordination. Skip for ordinary single-agent work.', inputSchema: z.object({ agentId: z.string(), goalId: z.string().optional() }) }, afterReady(async ({ agentId, goalId }) => result(await claimProgressTicket(agentId, goalId, root))));
  server.registerTool('progress_update_step', { description: 'Report DONE or BLOCKED once after work on a ticket already claimed by this agent, with short non-empty evidence. Returns a compact acknowledgement.', inputSchema: z.object({ goalId: z.string(), stepId: z.string(), agentId: z.string(), status: z.enum(['BLOCKED', 'DONE']), evidence: z.array(z.string()).min(1) }) }, afterReady(async input => result(progressMutationResult(await updateProgressStep(input, root), input.goalId, input.stepId))));
  server.registerTool('progress_next', { description: 'Return ordered actionable milestones and blocked context separately.', inputSchema: goalIdSchema }, afterReady(async ({ goalId }) => result(progressNext(await readProgress(root), goalId))));
  server.registerTool('progress_set_mode', { description: 'Set automatic execution, or manual only with a visual-review or important-decision reason. Returns a compact acknowledgement.', inputSchema: modeSchema }, afterReady(async ({ goalId, mode, reason }) => { const progress = await setProgressMode(goalId, mode, reason, root); return result({ ...progressMutationResult(progress, goalId), next: progressNext(progress, goalId) }); }));
  server.registerTool('progress_open_dashboard', { description: 'Start or reuse the authenticated local Progress dashboard without opening a browser.', inputSchema: z.object({}) }, afterReady(async () => result(await openProgressDashboard(root))));
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) serveStdio(() => createProgressServer());
