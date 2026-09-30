import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { publicDiscoveryFailureDiagnosticSchema } from '../../packages/public-discovery/src/contracts.ts';
import { executeAdminQuery, readAdminJson, validateAdminScope } from './discovery-admin.mjs';

const cursorSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const rowSchema = z.strictObject({ eventId: cursorSchema.refine(value => value > 0),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/u), diagnostic: z.string().max(16_384) });

export function failureAuditQuery(input, ordinal, after = 0) {
  const scope = validateAdminScope(input);
  z.number().int().min(1).max(scope.entries.length).parse(ordinal);
  cursorSchema.parse(after);
  const key = scope.entries[ordinal - 1].key;
  return `SELECT event_id AS eventId, request_digest AS requestDigest, diagnostic_json AS diagnostic
    FROM public_discovery_failure_events INDEXED BY public_discovery_failure_events_key
    WHERE fingerprint = '${key.fingerprint}' AND media_kind = '${key.mediaKind}'
      AND parser_version = '${key.parserVersion}' AND rules_version = '${key.siteRulesVersion}'
      AND event_id > ${after} ORDER BY event_id LIMIT 101`;
}

export async function collectFailureAudit(input, ordinal, { after = 0, readPage = (scope, position, cursor) => executeAdminQuery(failureAuditQuery(scope, position, cursor)) } = {}) {
  const scope = validateAdminScope(input);
  z.number().int().min(1).max(scope.entries.length).parse(ordinal);
  cursorSchema.parse(after);
  const result = await readPage(scope, ordinal, after);
  if (!Number.isSafeInteger(result?.meta?.rows_read) || result.meta.rows_read < 0 || result.meta.rows_read > 404
    || result.meta.rows_written !== 0 || result.meta.changes !== 0 || result.meta.changed_db === true) throw new Error('failure-audit-cost-unverified');
  const rows = rowSchema.array().max(101).parse(result.rows);
  let previous = after;
  const events = rows.map(row => {
    if (row.eventId <= previous) throw new Error('failure-audit-cursor-invalid');
    previous = row.eventId;
    if (Buffer.byteLength(row.diagnostic) > 16_384) throw new Error('failure-audit-diagnostic-size');
    return { eventId: row.eventId, requestDigest: row.requestDigest,
      diagnostic: publicDiscoveryFailureDiagnosticSchema.parse(JSON.parse(row.diagnostic)) };
  });
  return { schemaVersion: 1, generatedAt: new Date().toISOString(),
    scopeDigest: createHash('sha256').update(JSON.stringify(validateAdminScope(input))).digest('hex'),
    ordinal, after, nextCursor: events.length > 100 ? events[99].eventId : null,
    events: events.slice(0, 100), rowsRead: result.meta.rows_read, rowsWritten: 0,
    historicalCompleteness: false, currentRequestStateIncluded: false };
}

export async function runFailureAudit(args, { readPage, output = value => process.stdout.write(`${value}\n`), directory = 'build/audits' } = {}) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--scope', '--request', '--after', '--local-oauth'].includes(flag) || !value || value.startsWith('--') || Object.hasOwn(options, flag)) throw new Error('failure-audit-arguments-invalid');
    options[flag] = value;
  }
  if (!options['--scope'] || !/^[1-9]\d{0,3}$/u.test(options['--request'] ?? '')
    || !/^\d{1,16}$/u.test(options['--after'] ?? '0')
    || !['true', 'false'].includes(options['--local-oauth'] ?? 'false')) throw new Error('failure-audit-arguments-invalid');
  const report = await collectFailureAudit(await readAdminJson(options['--scope']), Number(options['--request']), {
    after: Number(options['--after'] ?? 0),
    readPage: readPage ?? ((scope, ordinal, after) => executeAdminQuery(failureAuditQuery(scope, ordinal, after), { localOAuth: options['--local-oauth'] === 'true' })),
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(resolve(directory, 'failure-events-'));
  const path = resolve(root, 'page.json');
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(report, null, 2)}\n`); } finally { await file.close(); }
  output(JSON.stringify({ file: path, events: report.events.length, nextCursor: report.nextCursor, rowsRead: report.rowsRead, rowsWritten: 0 }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runFailureAudit(process.argv.slice(2)).catch(() => {
    process.stderr.write('failure-audit-failed: vérifier scope, curseur, accès D1 et migration 0031 ; aucune mutation effectuée.\n');
    process.exitCode = 1;
  });
}
