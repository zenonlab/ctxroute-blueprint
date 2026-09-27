/* global AbortSignal, fetch */
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const requestInit = { headers: { 'content-type': 'application/json' }, method: 'POST', redirect: 'error' };
const timeout = 15_000;
const admissionTimeout = 45_000;
const maxObservations = 40;
const observationDelay = 15_000;
const observerBudget = 24 * 60_000;
const observerByteLimit = 1024 * 1024;
const observerEnvelopeLimit = 128;
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
  const deadline = AbortSignal.timeout(path === 'requests' ? admissionTimeout : timeout);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  const response = await fetcher(`https://tobirink.com/v3/catalogue/discoveries/${path}`, { ...requestInit, body: JSON.stringify(body), signal: requestSignal });
  const payload = await response.json().catch(() => undefined);
  signal?.throwIfAborted();
  return { payload, status: response.status, requestId: response.headers.get('x-tobirink-request-id') };
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
export async function runDiscoveryCanaries({ fetcher = fetch, wait = sleep, now = Date.now, nonce = randomUUID(), report = writeReport, signal, onFixtureStart, onFixtureAdmission, onFixtureVerified } = {}) {
  const results = [];
  for (const fixture of fixtures) {
    await onFixtureStart?.(fixture);
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
    onFixtureAdmission?.(fixture, submission.requestId);
    report({ media: fixture.mediaKind, state: 'PENDING', elapsedMs: now() - startedAt });
    let verified = false;
    for (let observation = 1; observation <= maxObservations; observation += 1) {
      await wait(observationDelay, undefined, { signal });
      const response = await request(fetcher, 'lookup', lookupBody, signal);
      if (response.status !== 200) throw new Error(`discovery-canary-lookup-http-${response.status}`);
      const state = stateOf(response.payload, key);
      if (state?.state === 'VERIFIED') {
        assertVerified(state, fixture);
        await onFixtureVerified?.(fixture, submission.requestId);
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
  correlationId: z.string().uuid().optional(),
  task: z.enum(['agenda', 'agenda-admission', 'agenda-recovery', 'discovery', 'discovery-admission', 'discovery-lookup', 'discovery-refresh']),
  provider: z.enum(['anilist', 'kitsu', 'mangadex', 'mangaupdates', 'mixed', 'none']),
  result: z.enum(['backoff', 'changed', 'deduplicated', 'failed', 'unchanged']),
  pagesRequested: countSchema, ...Object.fromEntries(counts.map(key => [key, countSchema.optional()])),
  providerRequests: countSchema, acceptedResults: countSchema, retries: countSchema,
  durationMs: countSchema.max(3_600_000), providerTransportDurationMs: countSchema.max(3_600_000).optional(),
});
const observerError = reason => new Error(`discovery-canary-observer-${reason}`);
const writeReport = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const requestIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
const requestSchema = z.object({ schemaVersion: z.literal(1), type: z.literal('worker.request'), requestId: requestIdSchema,
  method: z.literal('POST'), routeFamily: z.literal('catalogue'), status: z.number().int(), durationMs: countSchema });
const expectationSchema = z.discriminatedUnion('task', [
  z.strictObject({ provider: z.enum(['anilist', 'kitsu', 'mangadex', 'mangaupdates', 'mixed', 'any']),
    status: z.literal(202), task: z.literal('discovery') }),
  z.strictObject({ status: z.literal(200), task: z.literal('discovery-lookup') }),
]);

export function createCostObservation() {
  const records = new Map();
  const expected = new Map();
  const matched = new Map();
  const decoder = new StringDecoder('utf8');
  let bytes = 0;
  let envelopes = 0;
  let frame = '';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let failure;
  function fail(reason) { failure ??= observerError(reason); throw failure; }
  function check() { if (failure) throw failure; }
  function validate(requestId) {
    const expectation = expected.get(requestId);
    const record = records.get(requestId);
    if (!expectation || !record) return;
    matched.delete(requestId);
    if (record.error) fail(record.error);
    if (record.request.status !== expectation.status || record.httpStatus !== expectation.status
      || record.httpTask !== expectation.task) fail('request-mismatch');
    const selected = record.costs.filter(cost => cost.task === expectation.task);
    if (selected.length === 0) fail('ambiguous-cost');
    for (const cost of record.costs) {
      if (cost.d1RowsRead === undefined || cost.d1RowsWritten === undefined) fail('invalid-cost');
      if (cost.providerHttpErrors > 0 || cost.providerNetworkErrors > 0) fail('provider-error');
    }
    if (expectation.task === 'discovery-lookup') {
      if (selected.length !== 1) fail('ambiguous-cost');
      const collector = selected[0];
      if (record.costs.length !== 1 || collector.provider !== 'none' || collector.providerRequests !== 0
        || collector.acceptedResults !== 0 || collector.result !== 'unchanged') fail('invalid-cost');
      matched.set(requestId, { ...collector });
      return;
    }
    const admissions = record.costs.filter(cost => cost.task === 'discovery-admission');
    if (admissions.length !== 1 || record.costs.length !== selected.length + 1) fail('ambiguous-cost');
    const admission = admissions[0];
    if (admission.provider !== 'none' || admission.providerRequests !== 0 || admission.acceptedResults !== 0
      || admission.result !== 'changed') fail('invalid-cost');
    for (const collector of selected) {
      if (counts.some(key => collector[key] === undefined)) fail('invalid-cost');
      const preProviderBackoff = collector.provider === 'none' && collector.providerRequests === 0
        && collector.acceptedResults === 0 && collector.result === 'backoff' && collector.queueSends === 1;
      if (collector.provider === 'none' && !preProviderBackoff) fail('provider-mismatch');
      if (collector.providerRequests === 0 && !preProviderBackoff) fail('no-provider-calls');
      if (collector.queueFailures > 0) fail('queue-failure');
      if (collector.acceptedResults === 0 && ['failed', 'backoff'].includes(collector.result) && collector.queueSends !== 1) fail('failed-result');
      if (collector.acceptedResults === 0 && !['failed', 'backoff'].includes(collector.result)) fail('accepted-results');
      if (collector.acceptedResults === 1 && ['failed', 'backoff'].includes(collector.result)) fail('failed-result');
      if (collector.acceptedResults > 1 || collector.acceptedResults === 1 && collector.result !== 'changed') fail('accepted-results');
    }
    const terminals = selected.filter(collector => collector.acceptedResults === 1 && collector.result === 'changed');
    if (terminals.length > 1) fail('ambiguous-cost');
    if (terminals.length === 0) return;
    const terminal = terminals[0];
    if (terminal.provider === 'none'
      || (expectation.provider !== 'any' && terminal.provider !== expectation.provider)) fail('provider-mismatch');
    const summary = Object.fromEntries(counts.map(key => [key, [admission, ...selected].reduce((total, cost) => total + (cost[key] ?? 0), 0)]));
    if (Object.values(summary).some(value => !Number.isSafeInteger(value))) fail('count-limit');
    if (summary.d1RowsRead > 300) fail('d1-budget');
    summary.durationMs = admission.durationMs;
    matched.set(requestId, { ...summary, provider: terminal.provider, result: terminal.result,
      collectorD1RowsRead: selected.reduce((total, cost) => total + cost.d1RowsRead, 0), admissionD1RowsRead: admission.d1RowsRead });
  }
  function consume() {
    let envelope;
    try { envelope = JSON.parse(frame); } catch { fail('invalid-frame'); }
    envelopes += 1;
    if (envelopes > observerEnvelopeLimit) fail('correlation-limit');
    if (envelope?.outcome !== 'ok') fail('outcome');
    if (!Array.isArray(envelope.exceptions) || envelope.exceptions.length !== 0) fail('exception');
    if (envelope.truncated === true) fail('truncated');
    if (envelope.event?.response?.status === 429) fail('http-429');
    if (!Array.isArray(envelope.logs)) fail('invalid-frame');
    const requests = [];
    const costs = [];
    let error;
    for (const log of envelope.logs) for (const message of Array.isArray(log?.message) ? log.message : []) {
      const serialized = z.string().safeParse(message);
      if (!serialized.success) continue;
      let event;
      try { event = JSON.parse(serialized.data); } catch { continue; }
      if (event?.type === 'native-collector.health') fail('queue-failure');
      if (event?.type === 'worker.error') fail('exception');
      if (event?.type === 'worker.request') {
        if (event.status === 429) fail('http-429');
        requests.push(event);
      }
      if (event?.type !== 'worker.cost') continue;
      if (event.provider429s > 0) fail('provider-429');
      if (event.queueFailures > 0) fail('queue-failure');
      const parsed = costSchema.safeParse(event);
      if (!parsed.success) error = 'invalid-cost';
      else costs.push(parsed.data);
    }
    if (requests.length === 0) {
      const continuations = costs.filter(cost => cost.task === 'discovery' && cost.correlationId !== undefined && expected.has(cost.correlationId));
      if (continuations.length > 1) fail('ambiguous-cost');
      const continuation = continuations[0];
      if (continuation !== undefined) {
        const record = records.get(continuation.correlationId);
        if (!record) fail('request-mismatch');
        record.costs.push(continuation);
        validate(continuation.correlationId);
      }
      return;
    }
    const parsedRequest = requestSchema.safeParse(requests[0]);
    if (requests.length !== 1 || !parsedRequest.success) error ??= 'request-mismatch';
    let httpTask;
    const requestUrl = z.string().safeParse(envelope.event?.request?.url);
    if (requestUrl.success && envelope.event?.request?.method === 'POST') {
      try {
        const url = new URL(requestUrl.data);
        if (url.origin === 'https://tobirink.com' && !url.search) {
          if (url.pathname === '/v3/catalogue/discoveries/requests') httpTask = 'discovery';
          if (url.pathname === '/v3/catalogue/discoveries/lookup') httpTask = 'discovery-lookup';
        }
      } catch { error ??= 'request-mismatch'; }
    }
    for (const request of requests) {
      if (!requestIdSchema.safeParse(request?.requestId).success) continue;
      const requestId = request.requestId;
      if (costs.some(cost => cost.task === 'discovery' && cost.correlationId !== undefined && cost.correlationId !== requestId)) error ??= 'request-mismatch';
      if (records.has(requestId)) {
        records.set(requestId, { error: 'duplicate-request' });
      } else {
        if (records.size >= observerEnvelopeLimit) fail('correlation-limit');
        records.set(requestId, { request: parsedRequest.data, costs, error, httpTask, httpStatus: envelope.event?.response?.status });
      }
      validate(requestId);
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
      else if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') depth -= 1;
      if (depth > 128) fail('depth-limit');
      if (depth === 0) { consume(); frame = ''; }
    }
  }
  return {
    check,
    track(requestId, expectation) {
      check();
      if (!requestIdSchema.safeParse(requestId).success) fail('invalid-request-id');
      const parsedExpectation = expectationSchema.safeParse(expectation);
      if (!parsedExpectation.success) fail('request-mismatch');
      if (expected.has(requestId)) fail('duplicate-request');
      if (expected.size >= observerReadinessAttempts + fixtures.length) fail('correlation-limit');
      expected.set(requestId, parsedExpectation.data);
      validate(requestId);
    },
    read(requestId) { check(); const value = matched.get(requestId); return value ? { ...value } : undefined; },
    push(chunk) {
      check();
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > observerByteLimit) fail('byte-limit');
      scan(decoder.write(data));
    },
    finish() { check(); scan(decoder.end()); if (depth !== 0) fail('truncated'); },
    snapshot() {
      const totals = { observedEvents: 0, ...Object.fromEntries(counts.map(key => [key, 0])),
        results: { backoff: 0, changed: 0, deduplicated: 0, failed: 0, unchanged: 0 } };
      for (const [requestId, cost] of matched) {
        if (expected.get(requestId).task !== 'discovery') continue;
        totals.observedEvents += 1;
        totals.results[cost.result] += 1;
        for (const key of counts) {
          const next = totals[key] + cost[key];
          if (!Number.isSafeInteger(next)) fail('count-limit');
          totals[key] = next;
        }
      }
      return totals;
    },
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
      '--format', 'json'], { cwd: new URL('../../', import.meta.url), env, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
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
  function check() { if (failure) throw failure; observation.check(); }
  return { failed, check, track: (requestId, expectation) => { check(); observation.track(requestId, expectation); },
    read: requestId => { check(); return observation.read(requestId); }, snapshot: observation.snapshot,
    close: () => { closePromise ??= close(); return closePromise; } };
}

async function awaitCostObserverReady(observer, fetcher, wait, signal) {
  const requestIds = [];
  const key = {
    fingerprint: createHash('sha256').update(`release-canary-observer:${randomUUID()}`).digest('hex'),
    mediaKind: 'UNKNOWN', parserVersion: 'release-canary-observer-v1', siteRulesVersion: 'canary-v1',
  };
  const body = { keys: [key], schemaVersion: 3 };
  for (let attempt = 1; attempt <= observerReadinessAttempts; attempt += 1) {
    const response = await request(fetcher, 'lookup', body, signal);
    if (response.status !== 200) throw new Error(`discovery-canary-lookup-http-${response.status}`);
    if (stateOf(response.payload, key)?.state !== 'MISS') throw observerError('readiness-probe');
    observer.track(response.requestId, { task: 'discovery-lookup', status: 200 });
    requestIds.push(response.requestId);
    await wait(observerReadinessDelay, undefined, { signal });
    observer.check();
    if (requestIds.some(requestId => observer.read(requestId))) return;
  }
  throw observerError('not-ready');
}

async function awaitFixtureCost(observer, requestId, wait, signal) {
  for (let attempt = 1; attempt <= fixtureCostObservationAttempts; attempt += 1) {
    const cost = observer.read(requestId);
    if (cost) return cost;
    await wait(fixtureCostObservationDelay, undefined, { signal });
  }
  const cost = observer.read(requestId);
  if (cost) return cost;
  throw observerError('missing-correlated-cost');
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
    const guardedFetch = (...args) => { controller.signal.throwIfAborted(); observer.check(); return fetcher(...args); };
    const work = async () => {
      await awaitCostObserverReady(observer, guardedFetch, observationWait, controller.signal);
      const value = await runDiscoveryCanaries({ ...canaryOptions, fetcher: guardedFetch, report, now, signal: controller.signal,
        onFixtureStart: () => observer.check(),
        onFixtureAdmission: (fixture, requestId) => observer.track(requestId, { task: 'discovery', provider: fixture.reference.provider, status: 202 }),
        onFixtureVerified: async (fixture, requestId) => {
          const cost = await awaitFixtureCost(observer, requestId, observationWait, controller.signal);
          observer.check();
          report({ schemaVersion: 1, type: 'discovery-canary.fixture-cost', media: fixture.mediaKind,
            ...Object.fromEntries(counts.map(key => [key, cost[key]])), collectorD1RowsRead: cost.collectorD1RowsRead,
            admissionD1RowsRead: cost.admissionD1RowsRead });
        },
      });
      await observationWait(5000, undefined, { signal: controller.signal });
      observer.check();
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
  if (!failure && totals.observedEvents !== fixtures.length) failure = observerError('missing-correlated-cost');
  if (!failure && totals.providerRequests === 0) failure = observerError('no-provider-calls');
  if (!failure && totals.provider429s > 0) failure = observerError('provider-429');
  if (!failure && totals.queueFailures > 0) failure = observerError('queue-failure');
  report({ schemaVersion: 1, type: 'discovery-canary.observation', scope: 'correlated-discovery-requests',
    state: failure ? 'INCOMPLETE' : 'COMPLETE', windowDurationMs: Math.max(0, now() - startedAt), ...totals });
  if (failure) throw failure;
  return results;
}

export function canaryFailureCode(error) {
  const code = z.string().safeParse(error?.message);
  if (!code.success) return 'discovery-canary-failed';
  return /^discovery-canary-(?:invalid-arguments|invalid-lookup|not-fresh|admission-not-pending|media-mismatch|title-mismatch|provider-reference-missing|(?:submit|lookup)-http-[1-5][0-9]{2}|terminal-(?:ANIME|MANGA)-(?:UNAVAILABLE|NOT_FOUND|AMBIGUOUS|MISS|INVALID)|observation-timeout-(?:ANIME|MANGA)|observer-(?:invalid-cost|invalid-frame|truncated|byte-limit|depth-limit|count-limit|correlation-limit|failed|exited|cleanup-failed|unsupported-platform|invalid-budget|interrupted|budget|readiness-probe|not-ready|no-provider-calls|provider-429|http-429|queue-failure|invalid-request-id|duplicate-request|request-mismatch|ambiguous-cost|failed-result|provider-error|provider-mismatch|accepted-results|d1-budget|outcome|exception|missing-correlated-cost))$/u.test(code.data)
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
