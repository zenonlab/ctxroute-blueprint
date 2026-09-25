/* global AbortSignal, fetch */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const requestInit = { headers: { 'content-type': 'application/json' }, method: 'POST', redirect: 'error' };
const timeout = 15_000;
const maxObservations = 40;
const observationDelay = 15_000;
const observerBudget = 24 * 60_000;
const observerByteLimit = 1024 * 1024;
const observerReadinessAttempts = 12;
const observerReadinessDelay = 2_500;
const fixtureCostObservationAttempts = 12;
const fixtureCostObservationDelay = 5_000;
const fixtures = [
  { mediaKind: 'ANIME', title: 'Odd Taxi', reference: { provider: 'anilist', externalId: '128547' } },
  { mediaKind: 'MANGA', title: 'Spirit Circle', reference: { provider: 'mangaupdates', externalId: '13893304082' } },
];

async function request(fetcher, path, body, signal) {
  signal?.throwIfAborted();
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
  const response = await fetcher(`https://tobirink.com/v3/catalogue/discoveries/${path}`, { ...requestInit, body: JSON.stringify(body), signal: requestSignal });
  const payload = await response.json().catch(() => undefined);
  signal?.throwIfAborted();
  return { payload, status: response.status };
}

function stateOf(payload, key) {
  if (!Array.isArray(payload) || payload.length !== 1 || payload[0]?.key?.fingerprint !== key.fingerprint) {
    throw new Error('discovery-canary-invalid-lookup');
  }
  return payload[0].state;
}

function assertVerified(state, fixture) {
  if (state.state !== 'VERIFIED') throw new Error(`discovery-canary-terminal-${state.state}`);
  const candidate = state.profile?.candidate;
  if (!candidate || candidate.mediaKind !== fixture.mediaKind) throw new Error('discovery-canary-media-mismatch');
  if (!candidate.titles.some(title => title.toLowerCase() === fixture.title.toLowerCase())) throw new Error('discovery-canary-title-mismatch');
  if (!state.profile.references?.some(({ provider, externalId }) => provider === fixture.reference.provider && externalId === fixture.reference.externalId)) {
    throw new Error('discovery-canary-provider-reference-missing');
  }
}

// Two new public fixture keys, exactly one admission each; never rearm history.
export async function runDiscoveryCanaries({ fetcher = fetch, wait = sleep, now = Date.now, nonce = randomUUID(), report = writeReport, signal, onFixtureStart, onFixtureVerified } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    onFixtureStart?.(fixture);
    const startedAt = now();
    const key = {
      fingerprint: createHash('sha256').update(`release-canary:${nonce}:${fixture.mediaKind}`).digest('hex'),
      mediaKind: fixture.mediaKind, parserVersion: 'release-canary-v2', siteRulesVersion: 'canary-v1',
    };
    const lookupBody = { keys: [key], schemaVersion: 3 };
    const initial = await request(fetcher, 'lookup', lookupBody, signal);
    if (initial.status !== 200 || stateOf(initial.payload, key)?.state !== 'MISS') throw new Error('discovery-canary-not-fresh');
    const query = { discoveryTitles: [fixture.title], explicitProviderReference: fixture.reference, mediaKind: fixture.mediaKind, sourceTitles: [fixture.title] };
    const submission = await request(fetcher, 'requests', { key, query, schemaVersion: 3 }, signal);
    if (submission.status !== 202) throw new Error(`discovery-canary-submit-http-${submission.status}`);
    if (submission.payload?.state !== 'PENDING') throw new Error('discovery-canary-admission-not-pending');
    report({ media: fixture.mediaKind, state: 'PENDING', elapsedMs: now() - startedAt });
    let verified = false;
    for (let observation = 1; observation <= maxObservations; observation += 1) {
      await wait(observationDelay, undefined, { signal });
      const response = await request(fetcher, 'lookup', lookupBody, signal);
      if (response.status !== 200) throw new Error(`discovery-canary-lookup-http-${response.status}`);
      const state = stateOf(response.payload, key);
      if (state?.state === 'VERIFIED') {
        assertVerified(state, fixture);
        await onFixtureVerified?.(fixture);
        const result = { media: fixture.mediaKind, state: 'VERIFIED', observations: observation, elapsedMs: now() - startedAt };
        results.push(result);
        report(result);
        verified = true;
        break;
      }
      if (state?.state !== 'PENDING') throw new Error(`discovery-canary-terminal-${fixture.mediaKind}-${['UNAVAILABLE', 'NOT_FOUND', 'AMBIGUOUS', 'MISS'].includes(state?.state) ? state.state : 'INVALID'}`);
      report({ media: fixture.mediaKind, state: 'PENDING', observations: observation, elapsedMs: now() - startedAt });
    }
    if (!verified) throw new Error(`discovery-canary-observation-timeout-${fixture.mediaKind}`);
  }
  return results;
}

const counts = ['providerRequests', 'acceptedResults', 'retries', 'durationMs', 'providerTransportDurationMs', 'provider429s',
  'providerHttpErrors', 'providerNetworkErrors', 'd1RowsRead', 'd1RowsWritten', 'queueSends', 'queueFailures'];
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const costSchema = z.object({
  schemaVersion: z.literal(1), type: z.literal('worker.cost'),
  task: z.enum(['agenda', 'agenda-admission', 'agenda-recovery', 'discovery', 'discovery-admission', 'discovery-lookup', 'discovery-refresh']),
  provider: z.enum(['anilist', 'kitsu', 'mangadex', 'mangaupdates', 'mixed', 'none']),
  result: z.enum(['backoff', 'changed', 'deduplicated', 'failed', 'unchanged']),
  pagesRequested: countSchema, ...Object.fromEntries(counts.map(key => [key, countSchema.optional()])),
  providerRequests: countSchema, acceptedResults: countSchema, retries: countSchema,
  durationMs: countSchema.max(3_600_000), providerTransportDurationMs: countSchema.max(3_600_000).optional(),
});
const observerError = reason => new Error(`discovery-canary-observer-${reason}`);
const writeReport = value => process.stdout.write(`${JSON.stringify(value)}\n`);

// Keep only aggregate numbers. Wrangler's pretty-printed JSON may span any chunks.
export function createCostObservation() {
  const totals = { observedEvents: 0, ...Object.fromEntries(counts.map(key => [key, 0])),
    results: { backoff: 0, changed: 0, deduplicated: 0, failed: 0, unchanged: 0 } };
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  let frame = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  function consume() {
    let envelope;
    try { envelope = JSON.parse(frame); } catch { throw observerError('invalid-frame'); }
    if (!Array.isArray(envelope?.logs)) return;
    for (const log of envelope.logs) for (const message of Array.isArray(log?.message) ? log.message : []) {
      const serialized = z.string().safeParse(message);
      if (!serialized.success) continue;
      let event;
      try { event = JSON.parse(serialized.data); } catch { continue; }
      if (event?.type !== 'worker.cost') continue;
      const parsed = costSchema.safeParse(event);
      if (!parsed.success) throw observerError('invalid-cost');
      const cost = parsed.data;
      if (!cost.task.startsWith('discovery')) continue;
      if ((cost.task === 'discovery' || cost.providerRequests > 0) && counts.some(key => cost[key] === undefined)) throw observerError('invalid-cost');
      totals.observedEvents += 1;
      totals.results[cost.result] += 1;
      for (const key of counts) {
        const next = totals[key] + (cost[key] ?? 0);
        if (!Number.isSafeInteger(next)) throw observerError('count-limit');
        totals[key] = next;
      }
    }
  }
  function scan(value) {
    for (const char of value) {
      if (depth === 0) {
        if (char !== '{') continue;
        frame = '{'; depth = 1; quoted = false; escaped = false;
        continue;
      }
      frame += char;
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      if (depth > 128) throw observerError('depth-limit');
      if (depth === 0) { consume(); frame = ''; }
    }
  }
  return {
    push(chunk) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > observerByteLimit) throw observerError('byte-limit');
      scan(decoder.write(data));
    },
    finish() { scan(decoder.end()); if (depth !== 0) throw observerError('truncated'); },
    snapshot: () => ({ ...totals, results: { ...totals.results } }),
  };
}

export function startCostObserver({ spawnProcess = spawn, killProcess = process.kill.bind(process), platform = process.platform } = {}) {
  // The CI observer owns a POSIX process group so npm's Wrangler descendants cannot outlive it.
  if (platform === 'win32') throw observerError('unsupported-platform');
  const env = { ...process.env, WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false', WRANGLER_LOG: 'warn', FORCE_COLOR: '0', npm_config_logs_max: '0' };
  delete env.WRANGLER_OUTPUT_FILE_PATH;
  delete env.WRANGLER_OUTPUT_FILE_DIRECTORY;
  let child;
  try {
    child = spawnProcess('npm', ['exec', '--no', '--', 'wrangler', 'tail', 'tobirink-public-api', '--config', 'apps/worker/wrangler.jsonc',
      '--format', 'json', '--search', 'worker.cost'], { cwd: new URL('../../', import.meta.url), env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { throw observerError('failed'); }
  const groupId = child.pid;
  const observation = createCostObservation();
  let stopping = false;
  let exited = false;
  let closePromise;
  let failure;
  let rejectFailure;
  const failed = new Promise((_resolve, reject) => { rejectFailure = reject; });
  // A synchronous mock or spawn error can precede the caller attaching its race.
  failed.catch(() => undefined);
  const fail = error => { failure ??= error; rejectFailure(failure); };
  const closed = new Promise(resolve => { child.once('close', () => { exited = true; resolve(); if (!stopping) fail(observerError('exited')); }); });
  child.on('error', () => fail(observerError('failed')));
  child.stdout.on('error', () => fail(observerError('failed')));
  child.stdout.on('data', chunk => { if (!failure) { try { observation.push(chunk); } catch (error) { fail(error); } } });
  function terminate(signal) {
    if (!Number.isSafeInteger(groupId) || groupId <= 0) return;
    try { killProcess(-groupId, signal); } catch (error) { if (error.code !== 'ESRCH') throw observerError('cleanup-failed'); }
  }
  async function waitForClose(ms) {
    let timer;
    try { await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, ms); })]); }
    finally { clearTimeout(timer); }
  }
  async function close() {
    stopping = true;
    if (!exited) {
      terminate('SIGTERM');
      await waitForClose(2000);
      if (!exited) { terminate('SIGKILL'); await waitForClose(1000); }
      if (!exited) throw observerError('cleanup-failed');
    }
    if (failure) throw failure;
    observation.finish();
  }
  return { failed, snapshot: observation.snapshot, close: () => { closePromise ??= close(); return closePromise; } };
}

async function awaitCostObserverReady(observer, fetcher, wait, signal) {
  const initialEvents = observer.snapshot().observedEvents;
  const key = {
    fingerprint: createHash('sha256').update(`release-canary-observer:${randomUUID()}`).digest('hex'),
    mediaKind: 'UNKNOWN', parserVersion: 'release-canary-observer-v1', siteRulesVersion: 'canary-v1',
  };
  const body = { keys: [key], schemaVersion: 3 };
  for (let attempt = 1; attempt <= observerReadinessAttempts; attempt += 1) {
    const response = await request(fetcher, 'lookup', body, signal);
    if (response.status !== 200) throw new Error(`discovery-canary-lookup-http-${response.status}`);
    if (stateOf(response.payload, key)?.state !== 'MISS') throw observerError('readiness-probe');
    await wait(observerReadinessDelay, undefined, { signal });
    if (observer.snapshot().observedEvents > initialEvents) return;
  }
  throw observerError('not-ready');
}

async function awaitFixtureCost(observer, before, wait, signal) {
  let after = before;
  for (let attempt = 1; attempt <= fixtureCostObservationAttempts; attempt += 1) {
    await wait(fixtureCostObservationDelay, undefined, { signal });
    after = observer.snapshot();
    const provider429s = after.provider429s - before.provider429s;
    const queueFailures = after.queueFailures - before.queueFailures;
    if (provider429s > 0) throw observerError('provider-429');
    if (queueFailures > 0) throw observerError('queue-failure');
    if (after.providerRequests - before.providerRequests > 0) return after;
  }
  throw observerError('no-provider-calls');
}

export async function runObservedDiscoveryCanaries({ observerFactory = startCostObserver, observationWait = sleep, signals = process,
  budgetMs = observerBudget, fetcher = fetch, report = writeReport, now = Date.now, ...canaryOptions } = {}) {
  if (!Number.isInteger(budgetMs) || budgetMs < 1 || budgetMs > observerBudget) throw observerError('invalid-budget');
  const controller = new AbortController();
  const startedAt = now();
  let observer;
  let results;
  let failure;
  let rejectInterrupted;
  const interrupted = new Promise((_resolve, reject) => { rejectInterrupted = reject; });
  const interrupt = reason => { const error = observerError(reason); controller.abort(error); rejectInterrupted(error); };
  const onSignal = () => interrupt('interrupted');
  const timer = setTimeout(() => interrupt('budget'), budgetMs);
  signals.once('SIGTERM', onSignal);
  signals.once('SIGINT', onSignal);
  try {
    observer = observerFactory();
    let before;
    const work = async () => {
      await awaitCostObserverReady(observer, fetcher, observationWait, controller.signal);
      const value = await runDiscoveryCanaries({ ...canaryOptions, fetcher, report, now, signal: controller.signal,
        onFixtureStart: () => { before = observer.snapshot(); },
        onFixtureVerified: async (fixture) => {
          const after = await awaitFixtureCost(observer, before, observationWait, controller.signal);
          const providerRequests = after.providerRequests - before.providerRequests;
          const provider429s = after.provider429s - before.provider429s;
          const queueFailures = after.queueFailures - before.queueFailures;
          report({ schemaVersion: 1, type: 'discovery-canary.fixture-cost', media: fixture.mediaKind,
            providerRequests, provider429s, queueFailures, acceptedResults: after.acceptedResults - before.acceptedResults,
            d1RowsRead: after.d1RowsRead - before.d1RowsRead, d1RowsWritten: after.d1RowsWritten - before.d1RowsWritten });
        },
      });
      await observationWait(5000, undefined, { signal: controller.signal });
      return value;
    };
    results = await Promise.race([work(), observer.failed, interrupted]);
  } catch (error) { failure = error; }
  finally {
    controller.abort();
    clearTimeout(timer);
    signals.removeListener('SIGTERM', onSignal);
    signals.removeListener('SIGINT', onSignal);
    try { await observer?.close(); } catch (error) { failure ??= error; }
  }
  const totals = observer?.snapshot() ?? createCostObservation().snapshot();
  if (!failure && totals.observedEvents === 0) failure = observerError('no-events');
  if (!failure && totals.providerRequests === 0) failure = observerError('no-provider-calls');
  if (!failure && totals.provider429s > 0) failure = observerError('provider-429');
  if (!failure && totals.queueFailures > 0) failure = observerError('queue-failure');
  report({ schemaVersion: 1, type: 'discovery-canary.observation', scope: 'discovery-traffic-window',
    state: failure ? 'INCOMPLETE' : 'COMPLETE', windowDurationMs: Math.max(0, now() - startedAt), ...totals });
  if (failure) throw failure;
  return results;
}

export function canaryFailureCode(error) {
  const code = z.string().safeParse(error?.message);
  if (!code.success) return 'discovery-canary-failed';
  return /^discovery-canary-(?:invalid-arguments|invalid-lookup|not-fresh|admission-not-pending|media-mismatch|title-mismatch|provider-reference-missing|(?:submit|lookup)-http-[1-5][0-9]{2}|terminal-(?:ANIME|MANGA)-(?:UNAVAILABLE|NOT_FOUND|AMBIGUOUS|MISS|INVALID)|observation-timeout-(?:ANIME|MANGA)|observer-(?:invalid-cost|invalid-frame|truncated|byte-limit|depth-limit|count-limit|failed|exited|cleanup-failed|unsupported-platform|invalid-budget|interrupted|budget|readiness-probe|not-ready|no-events|no-provider-calls|provider-429|queue-failure))$/u.test(code.data)
    ? code.data : 'discovery-canary-failed';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const run = args.length === 0 ? runDiscoveryCanaries : args.length === 1 && args[0] === '--observe' ? runObservedDiscoveryCanaries : undefined;
  const task = run ? run() : Promise.reject(new Error('discovery-canary-invalid-arguments'));
  task.catch(error => {
    process.stderr.write(`${canaryFailureCode(error)}\n`); process.exitCode = 1;
  });
}
