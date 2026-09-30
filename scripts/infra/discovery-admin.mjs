import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { publicDiscoveryFailureDiagnosticSchema, publicDiscoveryKeyV3Schema, publicDiscoveryProviderSchema } from '../../packages/public-discovery/src/contracts.ts';
import { recoveryD1Invocation } from './discovery-recovery-batch.mjs';

const keyId = key => JSON.stringify([key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion]);
const scopeSchema = z.strictObject({ schemaVersion: z.literal(1), entries: z.array(z.strictObject({
  key: publicDiscoveryKeyV3Schema, sourceCount: z.number().int().min(1).max(50_000),
})).min(1).max(2000) }).refine(scope => new Set(scope.entries.map(entry => keyId(entry.key))).size === scope.entries.length
  && scope.entries.reduce((total, entry) => total + entry.sourceCount, 0) <= 50_000, 'admin-scope-duplicates-or-size');
const dateSchema = z.iso.datetime({ offset: false }).nullable();
const stateSchema = z.enum(['MISSING', 'PENDING', 'PROCESSING', 'VERIFIED', 'NOT_FOUND', 'AMBIGUOUS', 'FAILED']);
const entrySchema = z.strictObject({
  ordinal: z.number().int().min(1).max(2000), sourceCount: z.number().int().min(1).max(50_000),
  media: publicDiscoveryKeyV3Schema.shape.mediaKind, state: stateSchema,
  parserVersion: publicDiscoveryKeyV3Schema.shape.parserVersion, siteRulesVersion: publicDiscoveryKeyV3Schema.shape.siteRulesVersion,
  attempt: z.number().int().min(0).max(8), refreshAttempt: z.number().int().min(0).max(8),
  refreshState: z.enum(['IDLE', 'PENDING', 'PROCESSING']),
  failureReason: z.enum(['ATTEMPT_LIMIT', 'UNKNOWN']).nullable(),
  signal: z.enum(['UNSENT', 'SENDING', 'SENT', 'UNKNOWN']),
  updatedAt: dateSchema, failedAt: dateSchema, retryAt: dateSchema, leaseUntil: dateSchema, resultExpiresAt: dateSchema,
  hasCheckpoint: z.boolean(),
  evidence: z.enum(['present', 'absent', 'invalid', 'migration-missing']),
  diagnostics: publicDiscoveryFailureDiagnosticSchema.array().max(8),
});
const reportSchema = z.strictObject({
  schemaVersion: z.literal(1), generatedAt: z.iso.datetime({ offset: false }), scopeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  diagnosticColumn: z.boolean(), queries: z.number().int().min(1).max(51), rowsRead: z.number().int().min(0).max(8128),
  rowsWritten: z.literal(0), entries: z.array(entrySchema).min(1).max(2000),
}).refine(report => report.entries.every((entry, index) => entry.ordinal === index + 1
  && (entry.evidence === 'present') === (entry.diagnostics.length > 0)
  && report.diagnosticColumn === (entry.evidence !== 'migration-missing'))
  && report.entries.reduce((total, entry) => total + entry.sourceCount, 0) <= 50_000, 'admin-report-inconsistent');
const metadataQuery = "SELECT name FROM pragma_table_info('public_discovery_requests_v3') WHERE name = 'failure_diagnostics_json' LIMIT 1";
const limits = Object.freeze({ retainedFailuresPerRequest: 8, completeHistory: false, atomicityCertified: false,
  rawProviderResponses: false, automaticExceptions: false, automaticRecovery: false,
  scopeOnly: true, sourceCounts: 'provided-by-private-scope', snapshotNotTransaction: true, localParsingCovered: false,
  providerFailuresAreNotLiveHealth: true, externalLogsCovered: false,
  notes: ['La rétention D1 peut supprimer les preuves ; snapshots distincts, sans archivage automatique.',
    'Une erreur de publication ne prouve pas une écriture partielle.',
    'Une cause répétée oriente une régression de pipeline, pas une exception par titre.',
    'Une absence de diagnostic ne signifie ni succès, ni panne de tous les fournisseurs.'] });

export function validateAdminScope(input) { return scopeSchema.parse(input); }

export function adminScopedQuery(input, offset, diagnosticColumn) {
  const scope = validateAdminScope(input);
  z.boolean().parse(diagnosticColumn);
  if (!Number.isInteger(offset) || offset < 0 || offset >= scope.entries.length) throw new Error('admin-offset-invalid');
  const values = scope.entries.slice(offset, offset + 40).map((entry, index) => {
    const key = entry.key;
    return `(${offset + index + 1}, '${key.fingerprint}', '${key.mediaKind}', '${key.parserVersion}', '${key.siteRulesVersion}')`;
  });
  return `WITH scope(position, fingerprint, media_kind, parser_version, rules_version) AS (VALUES ${values.join(',')})
    SELECT scope.position AS ordinal, request.state, request.attempt_count AS attempt,
      request.refresh_attempt_count AS refreshAttempt, request.refresh_state AS refreshState,
      request.failure_reason AS failureReason,
      request.queue_signal_state AS signal, request.updated_at AS updatedAt, request.failed_at AS failedAt,
      request.retry_at AS retryAt, request.lease_until AS leaseUntil, request.result_expires_at AS resultExpiresAt,
      request.search_progress_json IS NOT NULL AS hasCheckpoint,
      ${diagnosticColumn ? 'request.failure_diagnostics_json' : 'NULL'} AS diagnostics
    FROM scope LEFT JOIN public_discovery_requests_v3 AS request INDEXED BY sqlite_autoindex_public_discovery_requests_v3_1
      ON request.fingerprint = scope.fingerprint AND request.media_kind = scope.media_kind
      AND request.parser_version = scope.parser_version AND request.rules_version = scope.rules_version
    ORDER BY scope.position LIMIT 40`;
}

export function executeAdminQuery(sql, { localOAuth = false, run = spawnSync } = {}) {
  const invocation = recoveryD1Invocation(sql, { localOAuth });
  const result = run(invocation.command, invocation.args, { ...invocation.options, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) throw new Error('admin-d1-read-failed');
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { throw new Error('admin-d1-response-invalid'); }
  if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.success !== true || !Array.isArray(payload[0]?.results)) throw new Error('admin-d1-response-invalid');
  return { rows: payload[0].results, meta: payload[0].meta };
}

function diagnosticEvidence(raw, diagnosticColumn) {
  if (!diagnosticColumn) return { evidence: 'migration-missing', diagnostics: [] };
  if (raw == null) return { evidence: 'absent', diagnostics: [] };
  try {
    const encoded = z.string().max(16_384).parse(raw);
    if (Buffer.byteLength(encoded) > 16_384) throw new Error('admin-diagnostic-size');
    const diagnostics = publicDiscoveryFailureDiagnosticSchema.array().max(8).parse(JSON.parse(encoded));
    return { evidence: diagnostics.length > 0 ? 'present' : 'absent', diagnostics };
  } catch { return { evidence: 'invalid', diagnostics: [] }; }
}

function normalizeEntry(row, source, diagnosticColumn) {
  const missing = row.state == null;
  return entrySchema.parse({ ordinal: row.ordinal, sourceCount: source.sourceCount, media: source.key.mediaKind,
    parserVersion: source.key.parserVersion, siteRulesVersion: source.key.siteRulesVersion,
    state: missing ? 'MISSING' : row.state, attempt: missing ? 0 : row.attempt,
    refreshAttempt: missing ? 0 : row.refreshAttempt, refreshState: missing ? 'IDLE' : row.refreshState,
    failureReason: row.failureReason == null ? null : row.failureReason === 'ATTEMPT_LIMIT' ? 'ATTEMPT_LIMIT' : 'UNKNOWN',
    signal: missing ? 'UNKNOWN' : row.signal, updatedAt: row.updatedAt, failedAt: row.failedAt,
    retryAt: row.retryAt, leaseUntil: row.leaseUntil, resultExpiresAt: row.resultExpiresAt,
    hasCheckpoint: row.hasCheckpoint === 1, ...diagnosticEvidence(row.diagnostics, diagnosticColumn) });
}

export async function collectAdminSnapshot(input, { query = executeAdminQuery, now = new Date().toISOString() } = {}) {
  const scope = validateAdminScope(input);
  z.iso.datetime({ offset: false }).parse(now);
  let queries = 0;
  let rowsRead = 0;
  const read = async sql => {
    const result = await query(sql);
    queries += 1;
    if (!Array.isArray(result?.rows) || !Number.isSafeInteger(result.meta?.rows_read) || result.meta.rows_read < 0
      || result.meta.rows_written !== 0 || result.meta.changes !== 0 || result.meta.changed_db === true) throw new Error('admin-read-cost-unverified');
    rowsRead += result.meta.rows_read;
    if (queries > 51 || rowsRead > scope.entries.length * 4 + 128) throw new Error('admin-read-budget-exceeded');
    return result.rows;
  };
  const columns = await read(metadataQuery);
  if (columns.length > 1 || columns.some(column => column.name !== 'failure_diagnostics_json')) throw new Error('admin-schema-invalid');
  const diagnosticColumn = columns.length === 1;
  const entries = [];
  for (let offset = 0; offset < scope.entries.length; offset += 40) {
    const rows = await read(adminScopedQuery(scope, offset, diagnosticColumn));
    if (rows.length !== Math.min(40, scope.entries.length - offset)) throw new Error('admin-row-count-invalid');
    for (const [index, row] of rows.entries()) {
      if (row.ordinal !== offset + index + 1) throw new Error('admin-row-order-invalid');
      entries.push(normalizeEntry(row, scope.entries[offset + index], diagnosticColumn));
    }
  }
  return reportSchema.parse({ schemaVersion: 1, generatedAt: now,
    scopeDigest: createHash('sha256').update(JSON.stringify(scope)).digest('hex'),
    diagnosticColumn, queries, rowsRead, rowsWritten: 0, entries });
}

function category(cause) {
  if (!cause || cause.code === 'unknown') return 'cause-inconnue';
  if (['http', 'network', 'timeout', 'gateway', 'transport'].includes(cause.code)) return 'acces-fournisseur';
  if (cause.code.startsWith('search-')) return 'recherche-pagination-budget';
  if (cause.code.startsWith('runtime-')) return 'infrastructure-interne';
  if (cause.code === 'identity-mismatch') return 'coherence-identite';
  return 'contrat-reponse-fournisseur';
}

function investigation(cause) {
  if (cause?.stage === 'publish') return 'Contrôler transaction, bail, conflit et reçu ; ne pas déduire une écriture partielle.';
  if (cause?.httpStatus === 401 || cause?.httpStatus === 403) return 'Vérifier accès fournisseur et transport avant toute relance.';
  if (cause?.httpStatus === 429) return 'Vérifier cadence partagée et Retry-After, sans augmenter les admissions.';
  const advice = {
    'cause-inconnue': 'Récupérer une preuve corrélée ; aucune exception de titre justifiable.',
    'acces-fournisseur': 'Examiner statut, délai et fallback réellement tenté ; ne pas modifier le favori.',
    'recherche-pagination-budget': 'Reproduire page et checkpoint ; vérifier progression et coût avant reprise.',
    'infrastructure-interne': 'Examiner D1, réservation et bail ; ajouter une régression sur la transition fautive.',
    'coherence-identite': 'Comparer références et média ; ne pas forcer une identité sur un titre ressemblant.',
    'contrat-reponse-fournisseur': 'Reproduire le champ rejeté ; distinguer métadonnée optionnelle et identité requise.',
  };
  return advice[category(cause)];
}

function groupEntries(entries, dimensions) {
  const groups = new Map();
  for (const entry of entries) {
    const fields = dimensions(entry);
    const key = JSON.stringify(fields);
    const group = groups.get(key) ?? { ...fields, identities: 0, sources: 0 };
    group.identities += 1;
    group.sources += entry.sourceCount;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => right.sources - left.sources || JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

export function adminViews(input) {
  const report = reportSchema.parse(input);
  const failed = report.entries.filter(entry => entry.state === 'FAILED');
  const latest = entry => entry.diagnostics.at(-1);
  const due = date => date !== null && Date.parse(date) <= Date.parse(report.generatedAt);
  const overdue = entry => ((entry.state === 'PENDING' || entry.refreshState === 'PENDING') && due(entry.retryAt))
    || ((entry.state === 'PROCESSING' || entry.refreshState === 'PROCESSING') && due(entry.leaseUntil));
  return {
    summary: { generatedAt: report.generatedAt, scopeDigest: report.scopeDigest, identities: report.entries.length,
      sources: report.entries.reduce((total, entry) => total + entry.sourceCount, 0), diagnosticColumn: report.diagnosticColumn,
      queries: report.queries, rowsRead: report.rowsRead, rowsWritten: 0,
      failedIdentities: failed.length, failedSources: failed.reduce((total, entry) => total + entry.sourceCount, 0),
      failedWithRetainedDiagnostics: failed.filter(entry => entry.evidence === 'present').length,
      failedWithoutRetainedDiagnostics: failed.filter(entry => entry.evidence !== 'present').length,
      journalsAtCapacity: report.entries.filter(entry => entry.diagnostics.length === 8).length,
      failedWithoutProviderAttribution: failed.filter(entry => latest(entry)?.cause.provider === undefined).length,
      failedWithoutWorkerVersion: failed.filter(entry => latest(entry)?.workerVersion === undefined).length },
    states: groupEntries(report.entries, entry => ({ state: entry.state, refreshState: entry.refreshState, signal: entry.signal,
      overdue: overdue(entry), expiredResult: ['NOT_FOUND', 'AMBIGUOUS'].includes(entry.state) && due(entry.resultExpiresAt) })),
    causes: groupEntries(failed, entry => ({ category: category(latest(entry)?.cause), evidence: entry.evidence,
      code: latest(entry)?.cause.code ?? 'unknown', provider: latest(entry)?.cause.provider ?? 'unknown',
      stage: latest(entry)?.cause.stage ?? 'unknown', httpStatus: latest(entry)?.cause.httpStatus ?? null,
      field: latest(entry)?.cause.field ?? null, validation: latest(entry)?.cause.validation ?? null,
      investigation: investigation(latest(entry)?.cause) })),
    providers: publicDiscoveryProviderSchema.options.map(provider => ({ provider, ...groupProvider(failed, provider) })),
    versions: groupEntries(failed, entry => ({ workerVersion: latest(entry)?.workerVersion ?? 'unknown',
      parserVersion: entry.parserVersion, siteRulesVersion: entry.siteRulesVersion })),
    requests: report.entries, limits,
  };
}

function groupProvider(entries, provider) {
  const affected = entries.filter(entry => entry.diagnostics.some(diagnostic => diagnostic.cause.provider === provider
    || diagnostic.providerFailures?.some(failure => failure.provider === provider)));
  return { identities: affected.length, sources: affected.reduce((total, entry) => total + entry.sourceCount, 0),
    retainedEvents: affected.reduce((total, entry) => total + entry.diagnostics.filter(diagnostic => diagnostic.cause.provider === provider
      || diagnostic.providerFailures?.some(failure => failure.provider === provider)).length, 0) };
}

export async function readAdminJson(path) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('admin-file-size');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}

export async function saveAdminSnapshot(input, directory = new URL('../../build/admin/', import.meta.url)) {
  const report = reportSchema.parse(input);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = await mkdtemp(resolve(directory instanceof URL ? fileURLToPath(directory) : directory, 'discovery-'));
  const destination = resolve(path, 'snapshot.json');
  const file = await open(destination, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(report, null, 2)}\n`); } finally { await file.close(); }
  return destination;
}

export function parseAdminArguments(args) {
  const [command = 'help', ...rest] = args;
  if (!['help', 'snapshot', 'report', 'menu'].includes(command)) throw new Error('admin-command-invalid');
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!['--scope', '--report', '--view', '--request', '--local-oauth'].includes(flag) || !value || value.startsWith('--') || options[flag] !== undefined) throw new Error('admin-arguments-invalid');
    options[flag] = value;
  }
  const allowed = command === 'snapshot' ? ['--scope', '--local-oauth'] : command === 'report' ? ['--report', '--view', '--request'] : command === 'menu' ? ['--report'] : [];
  if (Object.keys(options).some(flag => !allowed.includes(flag)) || (command === 'snapshot' && !options['--scope'])
    || (['menu', 'report'].includes(command) && !options['--report'])
    || (options['--local-oauth'] !== undefined && !['true', 'false'].includes(options['--local-oauth']))
    || (options['--request'] !== undefined && !/^[1-9]\d{0,3}$/u.test(options['--request']))) throw new Error('admin-arguments-invalid');
  return { command, options };
}

export async function runAdmin(args, { output = text => process.stdout.write(`${text}\n`), query, input = process.stdin, ask } = {}) {
  const { command, options } = parseAdminArguments(args);
  if (command === 'help') {
    output('Admin Discovery — lecture seule\nsnapshot --scope fichier.json [--local-oauth true]\nmenu --report snapshot.json\nreport --report snapshot.json [--view summary|states|causes|providers|versions|requests|limits] [--request N]\nAucun réarmement, SQL libre ou appel fournisseur.');
    return;
  }
  if (command === 'snapshot') {
    const report = await collectAdminSnapshot(await readAdminJson(options['--scope']), { query: query ?? (sql => executeAdminQuery(sql, { localOAuth: options['--local-oauth'] === 'true' })) });
    const file = await saveAdminSnapshot(report);
    output(JSON.stringify({ file, ...adminViews(report).summary }, null, 2));
    return;
  }
  const views = adminViews(await readAdminJson(options['--report']));
  if (command === 'report') {
    const view = options['--view'] ?? 'summary';
    if (!Object.hasOwn(views, view)) throw new Error('admin-view-invalid');
    const selected = options['--request'] === undefined ? views[view] : views.requests.find(entry => entry.ordinal === Number(options['--request']));
    if (selected === undefined) throw new Error('admin-request-absent');
    output(JSON.stringify(selected, null, 2));
    return;
  }
  const terminal = ask === undefined ? createInterface({ input, output: process.stdout }) : undefined;
  const question = ask ?? (prompt => terminal.question(prompt));
  const pages = ['summary', 'states', 'causes', 'providers', 'versions', 'requests', 'limits'];
  try {
    for (;;) {
      output('\n1 Synthèse · 2 États/échéances · 3 Causes FAILED · 4 Fournisseurs · 5 Versions · 6 Demande · 7 Limites · 0 Quitter');
      const choice = await question('Choix : ');
      if (choice === '0') break;
      if (!/^[1-7]$/u.test(choice)) continue;
      if (choice === '6') {
        const ordinal = await question(`Demande (1–${views.requests.length}) : `);
        const selected = /^[1-9]\d{0,3}$/u.test(ordinal) ? views.requests.find(entry => entry.ordinal === Number(ordinal)) : undefined;
        output(selected === undefined ? 'Demande absente.' : JSON.stringify(selected, null, 2));
      } else output(JSON.stringify(views[pages[Number(choice) - 1]], null, 2));
    }
  } finally { terminal?.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runAdmin(process.argv.slice(2)).catch(() => {
    process.stderr.write('admin-discovery-failed: vérifier les arguments, le format privé, les bornes et l’accès D1 ; aucun réarmement effectué.\n');
    process.exitCode = 1;
  });
}
