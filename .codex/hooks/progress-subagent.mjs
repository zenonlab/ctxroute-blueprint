import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { LIMITS, claimAutomaticProgressTicket, isSafeProgressReference, readProgress, releaseProgressClaims, updateProgressStep } from '../../scripts/progress-core.mjs';

const FOOTER_PREFIX = 'PROGRESS_RESULT: ';
const MAX_TICKET_CONTEXT_LENGTH = 8 * 1024;
const TRUNCATION_NOTICE = '[… ticket details truncated; inspect Progress only if the omitted detail is needed …]';

export function sessionOwnerPrefix(harness, sessionId) {
  return `${harness}:${opaqueHash(sessionId)}:`;
}

export function subagentOwner(harness, sessionId, agentId) {
  return `${sessionOwnerPrefix(harness, sessionId)}${opaqueHash(agentId)}`;
}

export function parseProgressResult(message) {
  if (message !== String(message)) return undefined;
  const lastLine = message.split(/\r?\n/u).findLast(line => line.trim());
  if (!lastLine?.startsWith(FOOTER_PREFIX) || lastLine.trim() !== lastLine) return undefined;
  if (insideMarkdownFence(message, lastLine)) return undefined;
  let value;
  try { value = JSON.parse(lastLine.slice(FOOTER_PREFIX.length)); }
  catch { return undefined; }
  if (!value || value !== Object(value) || Array.isArray(value)) return undefined;
  if (Object.keys(value).sort().join(',') !== 'evidence,status') return undefined;
  if (!['DONE', 'BLOCKED'].includes(value.status)) return undefined;
  if (!Array.isArray(value.evidence) || value.evidence.length < 1 || value.evidence.length > LIMITS.evidence) return undefined;
  if (value.evidence.some(item => !isSafeProgressReference(item))) return undefined;
  return { status: value.status, evidence: value.evidence };
}

export async function handleProgressLifecycle(harness, event, input, root = process.cwd()) {
  let payload;
  try { payload = JSON.parse(input || '{}'); }
  catch { return diagnostic(event, 'invalid hook input'); }
  if (!validIdentity(payload.session_id) || (event !== 'SessionEnd' && !validIdentity(payload.agent_id))) return diagnostic(event, 'missing session or agent identity');
  if ((event === 'SubagentStart' || event === 'SubagentStop') && !isProgressWorker(payload.agent_type)) return null;

  try {
    if (event === 'SubagentStart') return await startSubagent(harness, payload, root);
    if (event === 'SubagentStop') return await stopSubagent(harness, payload, root);
    if (event === 'SessionEnd') {
      await releaseProgressClaims(sessionOwnerPrefix(harness, payload.session_id), root, { lockWaitMs: 2_000 });
      return null;
    }
    return diagnostic(event, 'unsupported event');
  } catch (error) {
    return diagnostic(event, error.message);
  }
}

async function startSubagent(harness, payload, root) {
  const owner = subagentOwner(harness, payload.session_id, payload.agent_id);
  const claim = await claimAutomaticProgressTicket(owner, root);
  if (!claim.claimed) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext: ticketContext(claim.ticket),
    },
  };
}

async function stopSubagent(harness, payload, root) {
  const owner = subagentOwner(harness, payload.session_id, payload.agent_id);
  const ticket = findOwnedTicket(await readProgress(root), owner);
  if (!ticket) return null;
  const result = parseProgressResult(payload.last_assistant_message);
  if (!result) {
    await releaseProgressClaims(owner, root);
    return null;
  }
  try {
    await updateProgressStep({ ...ticket, agentId: owner, ...result }, root);
  } catch (error) {
    if (error.code === 'PROGRESS_BUSY') throw error;
    await releaseProgressClaims(owner, root);
  }
  return null;
}

function findOwnedTicket(progress, owner) {
  for (const goal of progress.goals) {
    const step = goal.steps.find(item => item.status === 'IN_PROGRESS' && item.assignee === owner);
    if (step) return { goalId: goal.id, stepId: step.id };
  }
  return undefined;
}

function ticketContext(ticket) {
  const header = [
    'Progress assigned this automatic ticket to you.',
    `Goal: ${ticket.goalId}`,
    `Ticket: ${ticket.stepId} — ${ticket.title}`,
  ].join('\n');
  const details = [
    section('Acceptance', ticket.acceptance),
    section('Files', ticket.files),
    section('Commands', ticket.commands),
  ].filter(Boolean).join('\n');
  const footer = [
    'Make the following footer your final non-empty line, outside any Markdown block:',
    'PROGRESS_RESULT: {"status":"DONE","evidence":["short verification reference"]}',
    'Use status BLOCKED only when the ticket cannot be completed, and include at least one short evidence reference.',
  ].join('\n');
  const fixedLength = header.length + footer.length + TRUNCATION_NOTICE.length + 4;
  const boundedDetails = details.length + fixedLength <= MAX_TICKET_CONTEXT_LENGTH
    ? details
    : `${details.slice(0, MAX_TICKET_CONTEXT_LENGTH - fixedLength)}\n${TRUNCATION_NOTICE}`;
  return [header, boundedDetails, footer].filter(Boolean).join('\n');
}

function section(title, items) {
  return items?.length ? `${title}:\n${items.map(item => `- ${item}`).join('\n')}` : '';
}

export function isProgressWorker(agentType) {
  return /^(?:progress-worker|progress_worker)$/iu.test(String(agentType ?? ''));
}

function opaqueHash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function insideMarkdownFence(message, footer) {
  let fence;
  for (const line of message.split(/\r?\n/u)) {
    if (line === footer) return Boolean(fence);
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];
    if (!marker) continue;
    if (!fence) fence = marker[0];
    else if (marker[0] === fence) fence = undefined;
  }
  return false;
}

function validIdentity(value) {
  return value === String(value) && value.length > 0 && value.length <= LIMITS.text;
}

function diagnostic(event, message) {
  const safe = String(message).replace(/[\r\n]+/gu, ' ').slice(0, 240);
  return { systemMessage: `Progress ${event} failed open: ${safe}` };
}

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value || '{}';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await handleProgressLifecycle(process.argv[2], process.argv[3], await stdin());
  if (result) process.stdout.write(JSON.stringify(result));
}
