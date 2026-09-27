/* global AbortSignal, fetch */
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { startCostObserver } from './manga-canary.mjs';

const batchLimit = 10;
const receiptDirectory = new URL('../../build/recovery/', import.meta.url);
const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const batchIdPattern = /^[a-z][a-z0-9-]{2,47}$/u;
const maxResponseBytes = 1024 * 1024;
const readinessAttempts = 4;
const readinessDelayMs = 2_500;
const costObservations = 12;
const costDelayMs = 5_000;
const terminalObservations = 40;
const terminalDelayMs = 15_000;
const candidateBudgetMs = 12 * 60_000;

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const titleSchema = z.string().trim().min(1).max(200);
const publicDiscoveryProviderSchema = z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']);
const mangaRecoveryProviders = Object.freeze(['kitsu-manga', 'mangadex', 'mangaupdates']);
const providerReadinessSchema = z.strictObject({
  availability: z.enum(['DEFERRED', 'READY']),
  provider: z.enum(['kitsu-manga', 'mangadex', 'mangaupdates']),
});
const publicDiscoveryKeyV3Schema = z.strictObject({
  fingerprint: fingerprintSchema,
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
  parserVersion: identifierSchema,
  siteRulesVersion: identifierSchema,
});
const publicDiscoveryReferenceV3Schema = z.strictObject({ externalId: identifierSchema, provider: publicDiscoveryProviderSchema });
const publicDiscoveryQuerySchema = z.strictObject({
  discoveryTitles: z.array(titleSchema).min(1).max(4),
  explicitProviderReference: publicDiscoveryReferenceV3Schema.optional(),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
  preSerialization: z.boolean().optional(),
  season: z.number().int().positive().max(1000).optional(),
  sourceFormat: z.string().trim().min(1).max(64).optional(),
  sourceTitles: z.array(titleSchema).max(4),
});
const publicDiscoveryRequestSchema = z.strictObject({
  key: publicDiscoveryKeyV3Schema,
  query: publicDiscoveryQuerySchema,
  requestDigest: fingerprintSchema,
  schemaVersion: z.literal(3),
});
const publicDiscoverySubmissionSchema = publicDiscoveryRequestSchema.omit({ requestDigest: true });
const coverSchema = z.strictObject({ attribution: z.string().trim().min(1).max(200), url: z.string().url().max(2048) });
const titleVariantSchema = z.strictObject({ language: z.string().trim().min(1).max(32).optional(), title: titleSchema });
const publicDiscoveryCandidateSchema = z.strictObject({
  canonicalUrl: z.string().url().max(2048).optional(),
  categories: z.array(z.string().trim().min(1).max(100)).max(32).optional(),
  chapterCount: z.number().int().nonnegative().optional(),
  contentClassification: z.enum(['adult', 'non-adult', 'unknown']).optional(),
  cover: coverSchema.optional(),
  displayTitle: titleSchema.optional(),
  editorialStatus: z.enum(['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN']).optional(),
  endYear: z.number().int().min(1800).max(3000).optional(),
  episodeCount: z.number().int().nonnegative().optional(),
  externalId: identifierSchema,
  format: z.string().trim().min(1).max(100).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(32).optional(),
  linkedReferences: z.array(publicDiscoveryReferenceV3Schema).max(5).optional(),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  metadataVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  popularity: z.strictObject({ kind: z.enum(['MEMBERS', 'RANK']), value: z.number().int().nonnegative() }).optional(),
  preSerialization: z.boolean(),
  provider: publicDiscoveryProviderSchema,
  season: z.number().int().positive().max(1000).optional(),
  startYear: z.number().int().min(1800).max(3000).optional(),
  titles: z.array(titleSchema).min(1).max(32),
  titleVariants: z.array(titleVariantSchema).max(32).optional(),
  volumeCount: z.number().int().nonnegative().optional(),
});
const publicDiscoveryVerifiedProfileSchema = z.strictObject({
  candidate: publicDiscoveryCandidateSchema,
  references: z.array(publicDiscoveryReferenceV3Schema).min(1).max(5),
  workId: identifierSchema,
});
const pendingStateSchema = z.strictObject({ retryAt: z.string().datetime({ offset: false }), state: z.literal('PENDING') });
const publicStateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('MISS') }),
  pendingStateSchema,
  z.strictObject({ reason: z.literal('ATTEMPT_LIMIT'), state: z.literal('UNAVAILABLE') }),
  z.strictObject({ nextRefreshAt: z.string().datetime({ offset: false }).optional(), profile: publicDiscoveryVerifiedProfileSchema,
    state: z.literal('VERIFIED'), verifiedAt: z.string().datetime({ offset: false }) }),
  z.strictObject({ reason: z.string().trim().min(1).max(200), state: z.literal('NOT_FOUND'),
    verifiedAt: z.string().datetime({ offset: false }) }),
  z.strictObject({ candidates: z.array(publicDiscoveryReferenceV3Schema).min(2).max(10),
    reason: z.string().trim().min(1).max(200), state: z.literal('AMBIGUOUS'),
    verifiedAt: z.string().datetime({ offset: false }) }),
]);
const lookupSchema = z.array(z.strictObject({ key: publicDiscoveryKeyV3Schema, state: publicStateSchema })).length(1);
const rowSchema = z.strictObject({
  attemptCount: z.literal(8),
  failedAt: z.string().datetime({ offset: false }),
  failureReason: z.literal('ATTEMPT_LIMIT'),
  fingerprint: z.string().regex(sha256Pattern),
  mediaKind: z.enum(['MANGA', 'MANHWA']),
  parserVersion: z.string().min(1).max(128),
  queueSignalState: z.string().min(1).max(32),
  requestDigest: z.string().regex(sha256Pattern),
  requestJson: z.string().max(65_536),
  siteRulesVersion: z.string().min(1).max(128),
  state: z.literal('FAILED'),
});
const journalAttemptSchema = z.strictObject({ index: z.number().int().min(1).max(batchLimit), media: z.enum(['MANGA', 'MANHWA']),
  state: z.enum(['POST_STARTED', 'TERMINAL']), terminal: z.enum(['VERIFIED', 'NOT_FOUND', 'AMBIGUOUS']).optional() });
const journalSchema = z.strictObject({
  attempts: z.array(journalAttemptSchema).max(batchLimit),
  batchId: z.string().regex(batchIdPattern),
  batchSeal: z.string().regex(sha256Pattern),
  candidates: z.array(z.strictObject({ fingerprint: fingerprintSchema, identitySeal: fingerprintSchema,
    mediaKind: z.enum(['MANGA', 'MANHWA']) })).length(batchLimit),
  schemaVersion: z.literal(2),
});

const query = `SELECT
  fingerprint,
  media_kind AS mediaKind,
  parser_version AS parserVersion,
  rules_version AS siteRulesVersion,
  request_digest AS requestDigest,
  request_json AS requestJson,
  state,
  failure_reason AS failureReason,
  failed_at AS failedAt,
  attempt_count AS attemptCount,
  queue_signal_state AS queueSignalState
FROM public_discovery_requests_v3
WHERE state = 'FAILED'
  AND failure_reason = 'ATTEMPT_LIMIT'
  AND attempt_count = 8
  AND media_kind IN ('MANGA', 'MANHWA')
ORDER BY failed_at ASC, fingerprint ASC
LIMIT 10`;
const mangaProviderReadinessQuery = `SELECT
  provider,
  CASE
    WHEN MAX(next_allowed_at, active_until, circuit_open_until) > (unixepoch() * 1000) THEN 'DEFERRED'
    ELSE 'READY'
  END AS availability
FROM public_discovery_provider_runtime
WHERE provider IN ('kitsu-manga', 'mangadex', 'mangaupdates')
ORDER BY provider ASC`;
function recoveryError(code) {
  return new Error(`discovery-recovery-${code}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sameKey(left, right) {
  return left.fingerprint === right.fingerprint && left.mediaKind === right.mediaKind
    && left.parserVersion === right.parserVersion && left.siteRulesVersion === right.siteRulesVersion;
}

export function validateCandidateRow(input) {
  const parsedRow = rowSchema.safeParse(input);
  if (!parsedRow.success) throw recoveryError('candidate-invalid');
  const row = parsedRow.data;
  let stored;
  try { stored = JSON.parse(row.requestJson); } catch { throw recoveryError('request-invalid'); }
  const parsedRequest = publicDiscoveryRequestSchema.safeParse(stored);
  if (!parsedRequest.success) throw recoveryError('request-invalid');
  const request = parsedRequest.data;
  const key = { fingerprint: row.fingerprint, mediaKind: row.mediaKind, parserVersion: row.parserVersion,
    siteRulesVersion: row.siteRulesVersion };
  if (!sameKey(request.key, key) || request.requestDigest !== row.requestDigest) throw recoveryError('identity-mismatch');
  if (request.query.mediaKind !== row.mediaKind) throw recoveryError('media-mismatch');
  const { requestDigest, ...candidateSubmission } = request;
  const submission = publicDiscoverySubmissionSchema.parse(candidateSubmission);
  if (digest(JSON.stringify(submission)) !== requestDigest) throw recoveryError('digest-mismatch');
  const requestJsonSha256 = digest(row.requestJson);
  const identitySeal = digest(JSON.stringify({ fingerprint: row.fingerprint, mediaKind: row.mediaKind,
    parserVersion: row.parserVersion, siteRulesVersion: row.siteRulesVersion, requestDigest, requestJsonSha256 }));
  return Object.freeze({ failedAt: row.failedAt, fingerprint: row.fingerprint, identitySeal, mediaKind: row.mediaKind, submission });
}

export function validateBatch(rows, expectedSeal) {
  if (!Array.isArray(rows) || rows.length !== batchLimit) throw recoveryError('batch-size');
  const candidates = rows.map(validateCandidateRow);
  const keys = candidates.map(candidate => JSON.stringify(candidate.submission.key));
  if (new Set(keys).size !== batchLimit) throw recoveryError('duplicate-key');
  const batchSeal = digest(candidates.map(candidate => candidate.identitySeal).join('\n'));
  if (expectedSeal !== undefined && batchSeal !== expectedSeal) throw recoveryError('batch-seal');
  return Object.freeze({ batchSeal, candidates });
}

export function assertMangaProvidersRegistered(rows) {
  if (!Array.isArray(rows) || rows.length !== mangaRecoveryProviders.length) throw recoveryError('provider-readiness-invalid');
  const providers = rows.map(row => {
    const parsed = providerReadinessSchema.safeParse(row);
    if (!parsed.success) throw recoveryError('provider-readiness-invalid');
    return parsed.data;
  });
  if (providers.map(provider => provider.provider).join('\n') !== mangaRecoveryProviders.join('\n')) {
    throw recoveryError('provider-readiness-invalid');
  }
  return Object.freeze(providers);
}

function receiptPath(batchId) {
  if (!batchIdPattern.test(batchId)) throw recoveryError('batch-id');
  return new URL(`discovery-recovery-batch-${batchId}.json`, receiptDirectory);
}

function sanitizedEnvironment() {
  const environment = { ...process.env, FORCE_COLOR: '0', WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false',
    npm_config_logs_max: '0' };
  delete environment.WRANGLER_OUTPUT_FILE_DIRECTORY;
  delete environment.WRANGLER_OUTPUT_FILE_PATH;
  return environment;
}

function queryRows(command) {
  const child = spawnSync('npm', ['exec', '--no', '--', 'wrangler', 'd1', 'execute', 'PUBLIC_DB', '--remote',
    '--config', 'apps/worker/wrangler.jsonc', '--json', '--command', command], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8', env: sanitizedEnvironment(), maxBuffer: maxResponseBytes,
    timeout: 45_000,
  });
  if (child.error || child.status !== 0 || child.signal != null) throw recoveryError('d1-query-failed');
  let output;
  try { output = JSON.parse(child.stdout); } catch { throw recoveryError('d1-query-invalid'); }
  const result = output?.[0];
  if (!Array.isArray(output) || output.length !== 1 || result?.success !== true || result.meta?.changes !== 0
    || result.meta?.rows_written !== 0 || result.meta?.changed_db === true || !Number.isSafeInteger(result.meta?.rows_read)
    || !Array.isArray(result.results)) throw recoveryError('d1-proof-failed');
  return { rows: result.results, rowsRead: result.meta.rows_read, rowsWritten: 0 };
}

function queryCandidates() {
  const proof = queryRows(query);
  const batch = validateBatch(proof.rows);
  const providerProof = queryRows(mangaProviderReadinessQuery);
  const providers = assertMangaProvidersRegistered(providerProof.rows);
  return { ...batch, providers, rowsRead: proof.rowsRead + providerProof.rowsRead, rowsWritten: proof.rowsWritten + providerProof.rowsWritten };
}

function queryMangaProvidersRegistered() {
  return assertMangaProvidersRegistered(queryRows(mangaProviderReadinessQuery).rows);
}

function queryPreparedRows(fingerprints) {
  if (!Array.isArray(fingerprints) || fingerprints.length < 1 || fingerprints.length > batchLimit || new Set(fingerprints).size !== fingerprints.length
    || fingerprints.some(fingerprint => !fingerprintSchema.safeParse(fingerprint).success)) throw recoveryError('journal-invalid');
  const quotedFingerprints = fingerprints.map(fingerprint => `'${fingerprint}'`).join(', ');
  const exactQuery = query.replace(/\nORDER BY failed_at ASC, fingerprint ASC\nLIMIT 10$/u,
    `\n  AND fingerprint IN (${quotedFingerprints})\nORDER BY failed_at ASC, fingerprint ASC`);
  return queryRows(exactQuery).rows;
}

async function loadJournal(batchId) {
  let serialized;
  try { serialized = await readFile(receiptPath(batchId), 'utf8'); } catch { throw recoveryError('receipt-missing'); }
  if (Buffer.byteLength(serialized) > 8192) throw recoveryError('journal-invalid');
  let value;
  try { value = JSON.parse(serialized); } catch { throw recoveryError('journal-invalid'); }
  const parsed = journalSchema.safeParse(value);
  if (!parsed.success) throw recoveryError('journal-invalid');
  return parsed.data;
}

export function selectRemainingCandidates(rows, journalInput) {
  const parsed = journalSchema.safeParse(journalInput);
  if (!parsed.success) throw recoveryError('journal-invalid');
  const journal = parsed.data;
  if (journal.attempts.some((attempt, index) => attempt.index !== index + 1 || attempt.state !== 'TERMINAL')) {
    throw recoveryError('receipt-incomplete');
  }
  const remainingEntries = journal.candidates.slice(journal.attempts.length);
  const candidatesByFingerprint = new Map(rows.map(row => {
    const candidate = validateCandidateRow(row);
    return [candidate.fingerprint, candidate];
  }));
  const preparedCandidates = remainingEntries.map(entry => {
    const candidate = candidatesByFingerprint.get(entry.fingerprint);
    return candidate?.identitySeal === entry.identitySeal && candidate.mediaKind === entry.mediaKind ? candidate : undefined;
  });
  if (preparedCandidates.length !== rows.length || preparedCandidates.some(candidate => candidate === undefined)
    || new Set(preparedCandidates).size !== preparedCandidates.length) {
    throw recoveryError('remaining-candidates-changed');
  }
  return preparedCandidates;
}

function postInit(body, signal, timeoutMs) {
  signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(timeoutMs);
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method: 'POST', redirect: 'error',
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline };
}

async function parseResponse(responsePromise) {
  let response;
  try { response = await responsePromise; }
  catch { throw recoveryError('network-failed'); }
  const text = await response.text().catch(() => undefined);
  if (text === undefined || Buffer.byteLength(text) > maxResponseBytes) throw recoveryError('response-invalid');
  let payload;
  try { payload = JSON.parse(text); } catch { throw recoveryError('response-invalid'); }
  return { payload, requestId: response.headers.get('x-tobirink-request-id'), status: response.status };
}

function postLookup(body, signal) {
  return parseResponse(fetch('https://tobirink.com/v3/catalogue/discoveries/lookup', postInit(body, signal, 15_000)));
}

function postRequest(body, signal) {
  return parseResponse(fetch('https://tobirink.com/v3/catalogue/discoveries/requests', postInit(body, signal, 45_000)));
}

function parseLookup(payload, expectedKey) {
  const parsed = lookupSchema.safeParse(payload);
  if (!parsed.success || !sameKey(parsed.data[0].key, expectedKey)) throw recoveryError('lookup-invalid');
  return parsed.data[0].state;
}

async function lookup(key, signal) {
  const response = await postLookup({ keys: [key], schemaVersion: 3 }, signal);
  if (response.status === 429) throw recoveryError('http-429');
  if (response.status !== 200) throw recoveryError(`lookup-http-${response.status}`);
  return { requestId: response.requestId, state: parseLookup(response.payload, key) };
}

async function awaitObserverReady(observer, signal) {
  const key = { fingerprint: digest(`discovery-recovery-observer:${randomUUID()}`), mediaKind: 'MANGA',
    parserVersion: 'discovery-recovery-observer-v1', siteRulesVersion: 'recovery-v1' };
  const requestIds = [];
  for (let attempt = 1; attempt <= readinessAttempts; attempt += 1) {
    const response = await lookup(key, signal);
    if (response.state.state !== 'MISS' || !requestIdPattern.test(response.requestId ?? '')) throw recoveryError('observer-readiness');
    observer.track(response.requestId, { status: 200, task: 'discovery-lookup' });
    requestIds.push(response.requestId);
    await sleep(readinessDelayMs, undefined, { signal });
    observer.check();
    if (requestIds.some(requestId => observer.read(requestId) !== undefined)) return;
  }
  throw recoveryError('observer-not-ready');
}

async function awaitTerminal(observer, key, signal) {
  for (let observation = 1; observation <= terminalObservations; observation += 1) {
    await sleep(terminalDelayMs, undefined, { signal });
    observer.check();
    const response = await lookup(key, signal);
    if (['VERIFIED', 'NOT_FOUND', 'AMBIGUOUS'].includes(response.state.state)) return { observation, state: response.state.state };
    if (response.state.state !== 'PENDING') throw recoveryError(`terminal-${response.state.state.toLowerCase()}`);
  }
  throw recoveryError('terminal-timeout');
}

async function awaitCost(observer, requestId, signal) {
  for (let attempt = 1; attempt <= costObservations; attempt += 1) {
    const cost = observer.read(requestId);
    if (cost !== undefined) return cost;
    await sleep(costDelayMs, undefined, { signal });
    observer.check();
  }
  throw recoveryError('cost-missing');
}

async function createJournal(batchId, batch) {
  const path = receiptPath(batchId);
  await mkdir(dirname(path.pathname), { mode: 0o700, recursive: true });
  const handle = await open(path, 'wx', 0o600).catch(() => { throw recoveryError('receipt-exists'); });
  const journal = { attempts: [], batchId, batchSeal: batch.batchSeal, candidates: batch.candidates.map(candidate => ({
    fingerprint: candidate.fingerprint, identitySeal: candidate.identitySeal, mediaKind: candidate.mediaKind })), schemaVersion: 2 };
  try { await handle.writeFile(`${JSON.stringify(journal)}\n`); } finally { await handle.close(); }
  return journal;
}

async function persistJournal(journal) {
  const parsed = journalSchema.safeParse(journal);
  if (!parsed.success) throw recoveryError('journal-invalid');
  const path = receiptPath(parsed.data.batchId);
  const temporary = new URL(`${path.href}.tmp`);
  await writeFile(temporary, `${JSON.stringify(parsed.data)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function executeCandidate(candidate, index, journal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(recoveryError('budget')), candidateBudgetMs);
  let observer;
  let failure;
  try {
    observer = startCostObserver({ allowProviderContinuation: true });
    const work = async () => {
      await awaitObserverReady(observer, controller.signal);
      const initial = await lookup(candidate.submission.key, controller.signal);
      if (initial.state.state !== 'UNAVAILABLE') throw recoveryError(`candidate-${initial.state.state.toLowerCase()}`);
      queryMangaProvidersRegistered();
      journal.attempts.push({ index, media: candidate.mediaKind, state: 'POST_STARTED' });
      await persistJournal(journal);
      const admission = await postRequest(candidate.submission, controller.signal);
      if (admission.status === 429) throw recoveryError('http-429');
      if (admission.status !== 202 || !requestIdPattern.test(admission.requestId ?? '')) throw recoveryError(`admission-http-${admission.status}`);
      if (!['PENDING', 'VERIFIED'].includes(admission.payload?.state)) throw recoveryError('admission-invalid');
      observer.track(admission.requestId, { provider: 'any', status: 202, task: 'discovery' });
      const [terminal, cost] = await Promise.all([
        admission.payload.state === 'VERIFIED' ? { observation: 0, state: 'VERIFIED' }
          : awaitTerminal(observer, candidate.submission.key, controller.signal),
        awaitCost(observer, admission.requestId, controller.signal),
      ]);
      if (cost.providerRequests < 1 || cost.acceptedResults < 1 || cost.provider429s > 0 || cost.providerHttpErrors > 0
        || cost.providerNetworkErrors > 0 || cost.queueFailures > 0 || cost.d1RowsRead > 300) throw recoveryError('cost-policy');
      journal.attempts[index - 1] = { index, media: candidate.mediaKind, state: 'TERMINAL', terminal: terminal.state };
      await persistJournal(journal);
      return { d1RowsRead: cost.d1RowsRead, index, media: candidate.mediaKind, observations: terminal.observation,
        provider: cost.provider, providerRequests: cost.providerRequests, state: terminal.state };
    };
    return await Promise.race([work(), observer.failed]);
  } catch (error) { failure = error; }
  finally {
    controller.abort();
    clearTimeout(timer);
    try { await observer?.close(); } catch (error) { failure ??= error; }
  }
  throw failure;
}

async function prepareBatch(batchId) {
  const batch = queryCandidates();
  const journal = await createJournal(batchId, batch);
  return { batchId: journal.batchId, batchSeal: journal.batchSeal, candidates: journal.candidates.length,
    media: journal.candidates.reduce((counts, candidate) => {
      counts[candidate.mediaKind] = (counts[candidate.mediaKind] ?? 0) + 1;
      return counts;
    }, {}), providers: batch.providers, rowsRead: batch.rowsRead, rowsWritten: batch.rowsWritten, schemaVersion: 1, type: 'discovery-recovery.prepared' };
}

async function executeBatch(batchId) {
  const journal = await loadJournal(batchId);
  const remainingFingerprints = journal.candidates.slice(journal.attempts.length).map(candidate => candidate.fingerprint);
  const candidates = selectRemainingCandidates(queryPreparedRows(remainingFingerprints), journal);
  const results = [];
  for (const candidate of candidates) {
    const result = await executeCandidate(candidate, journal.attempts.length + 1, journal);
    results.push(result);
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, type: 'discovery-recovery.progress', ...result })}\n`);
  }
  const terminals = journal.attempts.filter(attempt => attempt.state === 'TERMINAL');
  return { batchId, batchSeal: journal.batchSeal, completed: terminals.length, schemaVersion: 1,
    terminals: Object.fromEntries(['VERIFIED', 'NOT_FOUND', 'AMBIGUOUS'].map(state => [state, terminals.filter(attempt => attempt.terminal === state).length])),
    type: 'discovery-recovery.complete' };
}

export function safeFailureCode(error) {
  const parsed = z.string().safeParse(error?.message);
  return parsed.success && /^(?:discovery-recovery|discovery-canary-observer)-[a-z0-9-]+$/u.test(parsed.data)
    ? parsed.data : 'discovery-recovery-failed';
}

async function main() {
  const [mode, batchId] = process.argv.slice(2);
  if (!['--execute', '--preflight', '--prepare'].includes(mode) || (mode === '--preflight' ? process.argv.length !== 3
    : process.argv.length !== 4) || (mode !== '--preflight' && !batchIdPattern.test(batchId ?? ''))) throw recoveryError('invalid-arguments');
  if (mode === '--preflight') {
    const proof = queryCandidates();
    return { batchSeal: proof.batchSeal, candidates: proof.candidates.length, media: proof.candidates.reduce((counts, candidate) => {
      counts[candidate.mediaKind] = (counts[candidate.mediaKind] ?? 0) + 1;
      return counts;
    }, {}), providers: proof.providers, rowsRead: proof.rowsRead, rowsWritten: proof.rowsWritten, schemaVersion: 1, type: 'discovery-recovery.preflight' };
  }
  return mode === '--prepare' ? prepareBatch(batchId) : executeBatch(batchId);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(value => process.stdout.write(`${JSON.stringify(value)}\n`), error => {
    process.stderr.write(`${safeFailureCode(error)}\n`);
    process.exitCode = 1;
  });
}
