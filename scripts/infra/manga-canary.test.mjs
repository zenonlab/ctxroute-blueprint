/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import { canaryFailureCode, createCostObservation, runDiscoveryCanaries, runObservedDiscoveryCanaries, startCostObserver } from './manga-canary.mjs';

function fixtureFetcher({ initial = 'MISS', admission = 'PENDING', terminal = 'VERIFIED', admissionStatus = 202, wrongReference = false } = {}) {
  const admitted = new Map();
  const calls = [];
  return {
    calls,
    async fetcher(url, init) {
      const body = JSON.parse(init.body);
      const requestId = identity(calls.length + 1);
      const headers = { 'x-tobirink-request-id': requestId };
      calls.push({ url, body, requestId });
      if (url.endsWith('/requests')) {
        admitted.set(body.key.fingerprint, body.query);
        return Response.json({ state: admission }, { status: admissionStatus, headers });
      }
      const key = body.keys[0];
      const query = admitted.get(key.fingerprint);
      const state = query === undefined ? { state: initial } : terminal === 'VERIFIED'
        ? { state: terminal, profile: {
          candidate: { mediaKind: key.mediaKind, titles: query.sourceTitles },
          references: [{ ...query.explicitProviderReference, externalId: wrongReference ? '1' : query.explicitProviderReference.externalId }],
        } } : { state: terminal };
      return Response.json([{ key, state }], { headers });
    },
  };
}

test('new anime and manga keys prove MISS to PENDING to VERIFIED with two admissions only', async () => {
  const fixture = fixtureFetcher();
  const reports = [];
  let time = 0;
  const results = await runDiscoveryCanaries({ fetcher: fixture.fetcher, nonce: 'test-run-one', now: () => time, wait: ms => { time += ms; }, report: row => reports.push(row) });
  assert.deepEqual(results.map(row => [row.media, row.state]), [['ANIME', 'VERIFIED'], ['MANGA', 'VERIFIED']]);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 2);
  assert.deepEqual(fixture.calls.filter(call => call.url.endsWith('/requests')).map(call => call.body.query.explicitProviderReference), [
    { provider: 'anilist', externalId: '128547' }, { provider: 'mangaupdates', externalId: '13893304082' },
  ]);
  assert.equal(fixture.calls.length, 6);
  assert.deepEqual(results.map(row => row.elapsedMs), [15_000, 15_000]);
  assert.doesNotMatch(JSON.stringify(reports), /fingerprint|Odd Taxi|Spirit Circle|https:/u);
  const second = fixtureFetcher();
  await runDiscoveryCanaries({ fetcher: second.fetcher, nonce: 'test-run-two', wait: () => {}, report: () => {} });
  assert.notEqual(fixture.calls[0].body.keys[0].fingerprint, second.calls[0].body.keys[0].fingerprint);
});

test('admission allows 45 seconds while lookups retain 15 seconds and cancellation remains authoritative', async context => {
  const timeouts = [];
  context.mock.method(globalThis.AbortSignal, 'timeout', milliseconds => {
    timeouts.push(milliseconds);
    return new AbortController().signal;
  });
  const fixture = fixtureFetcher();
  await runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {} });
  assert.deepEqual(timeouts, [15000, 45000, 15000, 15000, 45000, 15000]);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 2);
  const controller = new AbortController();
  controller.abort(new Error('campaign-cancelled'));
  const cancelled = fixtureFetcher();
  await assert.rejects(runDiscoveryCanaries({ fetcher: cancelled.fetcher, signal: controller.signal, report: () => {} }), /campaign-cancelled/u);
  assert.equal(cancelled.calls.length, 0);
  assert.equal(timeouts.length, 6);
});

test('virtual time accepts slow worker-direct admissions but aborts at 45 seconds without retry', async context => {
  for (const responseDelay of [16000, 32000, 45001]) await context.test(String(responseDelay), async scenario => {
    scenario.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    scenario.mock.method(globalThis.AbortSignal, 'timeout', milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('request-timeout')), milliseconds);
      return controller.signal;
    });
    const fixture = fixtureFetcher();
    const result = runDiscoveryCanaries({ wait: () => {}, report: () => {}, fetcher: async (url, init) => {
      const response = await fixture.fetcher(url, init);
      if (!url.endsWith('/requests')) return response;
      return new Promise((resolve, reject) => {
        setTimeout(() => resolve(response), responseDelay);
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    } }).then(value => ({ value }), error => ({ error }));
    await yieldEventLoop();
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
    scenario.mock.timers.tick(Math.min(responseDelay, 45000));
    await yieldEventLoop();
    if (responseDelay > 45000) {
      assert.match((await result).error.message, /request-timeout/u);
      assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
    } else {
      assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 2);
      scenario.mock.timers.tick(responseDelay);
      assert.equal((await result).value.length, 2);
    }
  });
});

test('campaign cancellation aborts an ongoing admission before its 45-second deadline', async () => {
  const fixture = fixtureFetcher();
  const controller = new AbortController();
  let admissionSignal;
  const result = runDiscoveryCanaries({ signal: controller.signal, wait: () => {}, report: () => {}, fetcher: async (url, init) => {
    const response = await fixture.fetcher(url, init);
    if (!url.endsWith('/requests')) return response;
    admissionSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
  } });
  await yieldEventLoop();
  controller.abort(new Error('campaign-cancelled'));
  await assert.rejects(result, /campaign-cancelled/u);
  assert.equal(admissionSignal.aborted, true);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
});

test('cached initial or admitted VERIFIED cannot falsely certify a fresh provider run', async () => {
  for (const options of [{ initial: 'VERIFIED' }, { admission: 'VERIFIED' }]) {
    const fixture = fixtureFetcher(options);
    await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {} }), /not-fresh|admission-not-pending/u);
    assert.ok(fixture.calls.filter(call => call.url.endsWith('/requests')).length <= 1);
  }
});

test('a different public provider identity cannot certify either canary', async () => {
  const fixture = fixtureFetcher({ wrongReference: true });
  await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {} }), /provider-reference-missing/u);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
});

test('terminal failure or 429 stops immediately without rearming or retrying admission', async () => {
  for (const options of [{ terminal: 'UNAVAILABLE' }, { terminal: 'NOT_FOUND' }, { admissionStatus: 429 }]) {
    const fixture = fixtureFetcher(options);
    await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {} }), /terminal|submit-http-429/u);
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
  }
});

test('an indefinitely pending request stops at the finite observation budget', async () => {
  const fixture = fixtureFetcher({ terminal: 'PENDING' });
  let waits = 0;
  await assert.rejects(runDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => { waits += 1; }, report: () => {} }), /observation-timeout-ANIME/u);
  assert.equal(waits, 40);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
});

function identity(number) {
  return '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
}

function cost(overrides = {}) {
  return { schemaVersion: 1, type: 'worker.cost', task: 'discovery', provider: 'anilist', result: 'changed',
    pagesRequested: 0, providerRequests: 1, acceptedResults: 1, durationMs: 80, retries: 0,
    providerTransportDurationMs: 60, provider429s: 0, providerHttpErrors: 0, providerNetworkErrors: 0,
    d1RowsRead: 10, d1RowsWritten: 3, queueSends: 0, queueFailures: 0, ...overrides };
}

function lookupCost(overrides = {}) {
  return { schemaVersion: 1, type: 'worker.cost', task: 'discovery-lookup', provider: 'none', result: 'unchanged',
    pagesRequested: 0, providerRequests: 0, acceptedResults: 0, durationMs: 3, retries: 0,
    d1RowsRead: 0, d1RowsWritten: 0, ...overrides };
}

function admissionCost(overrides = {}) {
  return lookupCost({ task: 'discovery-admission', result: 'changed', durationMs: 100, d1RowsRead: 5, d1RowsWritten: 2, ...overrides });
}

function requestEvent(requestId, overrides = {}) {
  return { schemaVersion: 1, type: 'worker.request', requestId, method: 'POST', routeFamily: 'catalogue',
    status: 202, durationMs: 100, ...overrides };
}

function envelope(requestId, events = [cost(), admissionCost()], overrides = {}) {
  const admission = events.some(row => row.task === 'discovery');
  return { outcome: 'ok',
    event: { request: { method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/' + (admission ? 'requests' : 'lookup'),
      headers: { authorization: 'private-secret' } }, response: { status: admission ? 202 : 200 } },
    logs: [{ message: ['private title and payload', ...events.map(row => JSON.stringify(row)),
      JSON.stringify(requestEvent(requestId, { status: events.some(row => row.task === 'discovery') ? 202 : 200 }))] }],
    exceptions: [], ...overrides };
}

function queueEnvelope(correlationId, events = [cost({ correlationId })], overrides = {}) {
  return { outcome: 'ok', event: { queue: 'tobirink-public-discovery', batchSize: 1 },
    logs: [{ message: events.map(row => JSON.stringify(row)) }], exceptions: [], ...overrides };
}

const frame = value => JSON.stringify(value, null, 4) + '\n';
const expectation = { task: 'discovery', provider: 'anilist', status: 202 };

function fakeTail() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new PassThrough();
  const launches = [];
  const kills = [];
  return { child, launches, kills, platform: 'linux',
    spawnProcess: (...args) => { launches.push(args); return child; },
    killProcess: (pid, signal) => { kills.push([pid, signal]); child.stdout.end(); child.emit('close', 0); },
  };
}

function harness({ fixtureOptions, receive = ({ value, emit }) => emit(value), ...overrides } = {}) {
  const fake = fakeTail();
  const fixture = fixtureFetcher(fixtureOptions);
  const reports = [];
  const signals = new EventEmitter();
  const emit = value => fake.child.stdout.write(frame(value));
  const options = {
    fetcher: async (...args) => {
      const response = await fixture.fetcher(...args);
      const call = fixture.calls.at(-1);
      const events = call.url.endsWith('/requests')
        ? [cost({ provider: call.body.query.explicitProviderReference.provider }), admissionCost()] : [lookupCost()];
      const value = envelope(call.requestId, events);
      await receive({ call, response, value, emit, fake });
      return response;
    },
    wait: () => {}, observationWait: () => {}, report: row => reports.push(row), signals,
    observerFactory: () => startCostObserver(fake), ...overrides,
  };
  return { fake, fixture, reports, signals, emit, options,
    admissions: () => fixture.calls.filter(call => call.url.endsWith('/requests')).length };
}

test('foreign successful cost cannot certify a tracked admission', () => {
  const observation = createCostObservation();
  observation.track(identity(1), expectation);
  observation.push(frame(envelope(identity(2))));
  assert.equal(observation.read(identity(1)), undefined);
  assert.equal(observation.snapshot().providerRequests, 0);
});

test('missing or forged response identity fails closed before observation', () => {
  for (const requestId of [undefined, null, '', 'private-value', '00000000-0000-1000-8000-000000000001']) {
    assert.throws(() => createCostObservation().track(requestId, expectation), /observer-invalid-request-id/u);
  }
});

test('chunked UTF-8 frames correlate costs received before headers and redact all private data', () => {
  const observation = createCostObservation();
  const bytes = Buffer.from('CLI banner é\n' + frame(envelope(identity(1), [
    cost({ title: 'private } \\" title é', url: 'https://private.invalid' }), admissionCost(),
  ])));
  for (const byte of bytes) observation.push(Buffer.from([byte]));
  assert.equal(observation.snapshot().observedEvents, 0);
  observation.track(identity(1), expectation);
  observation.finish();
  const summary = observation.snapshot();
  assert.equal(summary.observedEvents, 1);
  assert.equal(summary.providerRequests, 1);
  assert.equal(summary.d1RowsRead, 15);
  assert.equal(summary.d1RowsWritten, 5);
  assert.equal(summary.durationMs, 100);
  assert.equal(summary.providerTransportDurationMs, 60);
  assert.equal(summary.results.changed, 1);
  assert.equal(observation.read(identity(1)).collectorD1RowsRead, 10);
  assert.doesNotMatch(JSON.stringify(summary), /private|title|url|https|authorization|secret|payload|exceptions|requestId|00000000/iu);
});

test('durable Queue continuation completes the same private-free cost certificate', () => {
  const requestId = identity(1);
  const observation = createCostObservation();
  observation.track(requestId, expectation);
  observation.push(frame(envelope(requestId, [
    cost({ acceptedResults: 0, correlationId: requestId, d1RowsRead: 40, d1RowsWritten: 8, providerRequests: 2, queueSends: 1, result: 'failed' }),
    admissionCost({ d1RowsRead: 15, d1RowsWritten: 7 }),
  ])));
  assert.equal(observation.read(requestId), undefined);
  observation.push(frame(queueEnvelope(requestId, [
    cost({ correlationId: requestId, d1RowsRead: 80, d1RowsWritten: 10 }),
  ])));
  const proof = observation.read(requestId);
  assert.equal(proof.providerRequests, 3);
  assert.equal(proof.acceptedResults, 1);
  assert.equal(proof.d1RowsRead, 135);
  assert.equal(proof.d1RowsWritten, 25);
  assert.equal(proof.collectorD1RowsRead, 120);
  assert.doesNotMatch(JSON.stringify(proof), /correlation|requestId|00000000/iu);
});

test('pre-provider cadence backoff waits for the correlated provider continuation', () => {
  const requestId = identity(1);
  const observation = createCostObservation();
  observation.track(requestId, expectation);
  observation.push(frame(envelope(requestId, [
    cost({ acceptedResults: 0, correlationId: requestId, d1RowsRead: 40, d1RowsWritten: 6,
      provider: 'none', providerRequests: 0, providerTransportDurationMs: 0, queueSends: 1, result: 'backoff' }),
    admissionCost({ d1RowsRead: 15, d1RowsWritten: 7 }),
  ])));
  assert.equal(observation.read(requestId), undefined);
  observation.push(frame(queueEnvelope(requestId, [
    cost({ correlationId: requestId, d1RowsRead: 80, d1RowsWritten: 10 }),
  ])));
  const proof = observation.read(requestId);
  assert.equal(proof.providerRequests, 1);
  assert.equal(proof.acceptedResults, 1);
  assert.equal(proof.queueSends, 1);
  assert.equal(proof.d1RowsRead, 135);
});

test('Queue continuation cannot certify another or missing admission', () => {
  const requestId = identity(1);
  const observation = createCostObservation();
  observation.track(requestId, expectation);
  assert.throws(() => observation.push(frame(queueEnvelope(requestId))), /request-mismatch/u);

  const foreign = createCostObservation();
  foreign.track(requestId, expectation);
  foreign.push(frame(envelope(requestId, [
    cost({ acceptedResults: 0, correlationId: requestId, queueSends: 1, result: 'failed' }), admissionCost(),
  ])));
  foreign.push(frame(queueEnvelope(identity(2))));
  assert.equal(foreign.read(requestId), undefined);

  const overBudget = createCostObservation();
  overBudget.track(requestId, expectation);
  overBudget.push(frame(envelope(requestId, [
    cost({ acceptedResults: 0, correlationId: requestId, d1RowsRead: 220, queueSends: 1, result: 'failed' }),
    admissionCost({ d1RowsRead: 30 }),
  ])));
  assert.throws(() => overBudget.push(frame(queueEnvelope(requestId, [
    cost({ correlationId: requestId, d1RowsRead: 51 }),
  ]))), /d1-budget/u);
});

test('request headers cannot reuse readiness or earlier admission proof', () => {
  const observation = createCostObservation();
  observation.track(identity(1), { task: 'discovery-lookup', status: 200 });
  observation.push(frame(envelope(identity(1), [lookupCost()])));
  assert.equal(observation.read(identity(1)).d1RowsRead, 0);
  assert.throws(() => observation.track(identity(1), expectation), /duplicate-request/u);
});

test('duplicate envelopes never inflate evidence even when duplicated before tracking', () => {
  for (const early of [true, false]) {
    const observation = createCostObservation();
    if (!early) observation.track(identity(1), expectation);
    observation.push(frame(envelope(identity(1))));
    assert.throws(() => {
      observation.push(frame(envelope(identity(1))));
      if (early) observation.track(identity(1), expectation);
    }, /duplicate-request/u);
    assert.equal(observation.snapshot().observedEvents, 0);
  }
});

test('ambiguous requests and collector costs cannot be assigned to the canary', () => {
  for (const value of [
    envelope(identity(1), [cost(), cost(), admissionCost()]),
    envelope(identity(1), [cost()]),
    envelope(identity(1), [cost(), admissionCost(), admissionCost()]),
    envelope(identity(1), [cost(), admissionCost(), requestEvent(identity(2))]),
    envelope(identity(1), [cost(), admissionCost(), requestEvent(identity(1))]),
  ]) {
    const observation = createCostObservation();
    observation.track(identity(1), expectation);
    assert.throws(() => observation.push(frame(value)), /ambiguous-cost|request-mismatch/u);
  }
});

test('request diagnostic must match POST catalogue 202 and have the exact header UUID', () => {
  for (const changes of [{ method: 'GET' }, { routeFamily: 'agenda' }, { status: 200 }, { durationMs: undefined }]) {
    const observation = createCostObservation();
    observation.track(identity(1), expectation);
    const value = envelope(identity(1));
    value.logs[0].message[value.logs[0].message.length - 1] = JSON.stringify(requestEvent(identity(1), changes));
    assert.throws(() => observation.push(frame(value)), /request-mismatch/u);
  }
  const observation = createCostObservation();
  observation.track(identity(1), expectation);
  const value = envelope(identity(2));
  value.event.response = { headers: { 'x-tobirink-request-id': identity(1) } };
  observation.push(frame(value));
  assert.equal(observation.read(identity(1)), undefined);
});

test('correlated evidence requires the actual HTTP admission envelope rather than a Queue frame', () => {
  for (const event of [
    { queue: 'public-discovery', batchSize: 1 },
    { request: { method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/requests' } },
    { request: { method: 'GET', url: 'https://tobirink.com/v3/catalogue/discoveries/requests' }, response: { status: 202 } },
    { request: { method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/lookup' }, response: { status: 202 } },
    { request: { method: 'POST', url: 'https://private.invalid/v3/catalogue/discoveries/requests' }, response: { status: 202 } },
    { request: { method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/requests' }, response: { status: 200 } },
  ]) {
    const observation = createCostObservation();
    observation.track(identity(1), expectation);
    assert.throws(() => observation.push(frame(envelope(identity(1), [cost(), admissionCost()], { event }))), /request-mismatch/u);
  }
});

test('collector contract requires every measured field, provider, one acceptance and successful result', () => {
  for (const [changes, reason] of [
    [{ provider: 'kitsu' }, 'provider-mismatch'],
    [{ providerRequests: 0 }, 'no-provider-calls'],
    [{ acceptedResults: 0 }, 'accepted-results'],
    [{ acceptedResults: 2 }, 'accepted-results'],
    [{ result: 'backoff' }, 'failed-result'],
    [{ result: 'failed' }, 'failed-result'],
    [{ result: 'unchanged' }, 'accepted-results'],
    [{ providerHttpErrors: 1 }, 'provider-error'],
    [{ providerNetworkErrors: 1 }, 'provider-error'],
    [{ providerRequests: -1 }, 'invalid-cost'],
    [{ providerTransportDurationMs: undefined }, 'invalid-cost'],
    [{ d1RowsRead: undefined }, 'invalid-cost'],
    [{ d1RowsWritten: undefined }, 'invalid-cost'],
    [{ queueFailures: undefined }, 'invalid-cost'],
    [{ provider429s: 0.5 }, 'provider-429'],
  ]) {
    const observation = createCostObservation();
    observation.track(identity(1), expectation);
    assert.throws(() => observation.push(frame(envelope(identity(1), [cost(changes), admissionCost()]))), new RegExp(reason, 'u'));
  }
});

test('provider-agnostic recovery proof still requires one real provider', () => {
  const tracked = { provider: 'any', task: 'discovery', status: 202 };
  const observation = createCostObservation();
  observation.track(identity(1), tracked);
  observation.push(frame(envelope(identity(1), [cost({ provider: 'mangaupdates' }), admissionCost()])));
  assert.equal(observation.read(identity(1)).provider, 'mangaupdates');

  const missing = createCostObservation();
  missing.track(identity(2), tracked);
  assert.throws(() => missing.push(frame(envelope(identity(2), [
    cost({ provider: 'none' }), admissionCost(),
  ]))), /provider-mismatch/u);

  assert.throws(() => createCostObservation().track(identity(3), { task: 'discovery', status: 202 }), /request-mismatch/u);
});

test('invocation budget sums distinct collector and admission D1 work with measured writes', () => {
  for (const [collectorReads, admissionReads, passes] of [[200, 100, true], [200, 101, false], [301, 0, false]]) {
    const observation = createCostObservation();
    observation.track(identity(1), expectation);
    const push = () => observation.push(frame(envelope(identity(1), [
      cost({ d1RowsRead: collectorReads }), admissionCost({ d1RowsRead: admissionReads }),
    ])));
    if (passes) { push(); assert.equal(observation.read(identity(1)).d1RowsRead, 300); }
    else assert.throws(push, /d1-budget/u);
  }
  for (const changes of [{ d1RowsRead: undefined }, { d1RowsWritten: undefined }, { providerRequests: 1 }, { result: 'failed' }]) {
    const observation = createCostObservation();
    observation.track(identity(1), expectation);
    assert.throws(() => observation.push(frame(envelope(identity(1), [cost(), admissionCost(changes)]))), /invalid-cost|failed-result/u);
  }
});

test('global CPU, exceptions, 429 and Queue signals immediately stop even without a cost event', () => {
  for (const [value, reason] of [
    [envelope(identity(99), [], { outcome: 'exceededCpu' }), 'outcome'],
    [envelope(identity(99), [], { outcome: 'exception' }), 'outcome'],
    [envelope(identity(99), [], { outcome: undefined }), 'outcome'],
    [envelope(identity(99), [], { exceptions: [{ message: 'private' }] }), 'exception'],
    [envelope(identity(99), [], { exceptions: undefined }), 'exception'],
    [envelope(identity(99), [], { truncated: true }), 'truncated'],
    [envelope(identity(99), [], { event: { response: { status: 429 } } }), 'http-429'],
    [envelope(identity(99), [requestEvent(identity(98), { status: 429 })]), 'http-429'],
    [envelope(identity(99), [cost({ provider429s: 1 })]), 'provider-429'],
    [envelope(identity(99), [cost({ queueFailures: 1 })]), 'queue-failure'],
    [envelope(identity(99), [{ type: 'native-collector.health', code: 'private' }]), 'queue-failure'],
    [envelope(identity(99), [{ type: 'worker.error', message: 'private' }]), 'exception'],
  ]) {
    assert.throws(() => createCostObservation().push(frame(value)), new RegExp(reason, 'u'));
  }
});

test('unrelated business failures never certify or taint successful correlated work', () => {
  const observation = createCostObservation();
  observation.track(identity(1), expectation);
  observation.push(frame(envelope(identity(99), [cost({ provider: 'kitsu', result: 'failed', acceptedResults: 0, d1RowsRead: 999999, providerHttpErrors: 3 })])));
  observation.push(frame(envelope(identity(1))));
  assert.equal(observation.snapshot().providerRequests, 1);
  assert.equal(observation.snapshot().d1RowsRead, 15);
  assert.equal(observation.snapshot().results.failed, 0);
});

test('bounds reject 129 envelopes, 15 tracked IDs, byte overflow, deep arrays and truncated JSON', () => {
  const envelopes = createCostObservation();
  for (let number = 1; number <= 128; number += 1) envelopes.push(frame(envelope(identity(number), [lookupCost()])));
  assert.throws(() => envelopes.push(frame(envelope(identity(129), [lookupCost()]))), /correlation-limit/u);
  const tracked = createCostObservation();
  for (let number = 1; number <= 14; number += 1) tracked.track(identity(number), expectation);
  assert.throws(() => tracked.track(identity(15), expectation), /correlation-limit/u);
  assert.throws(() => createCostObservation().push(Buffer.alloc(1024 * 1024 + 1)), /byte-limit/u);
  assert.throws(() => createCostObservation().push('{"nested":' + '['.repeat(128)), /depth-limit/u);
  assert.throws(() => createCostObservation().push('{"broken":}'), /invalid-frame/u);
  const truncated = createCostObservation();
  truncated.push('{"logs":[');
  assert.throws(() => truncated.finish(), /truncated/u);
});

test('tail is unfiltered, disables raw disk output and terminates only its own group', async () => {
  const fake = fakeTail();
  const observer = startCostObserver(fake);
  const [command, args, options] = fake.launches[0];
  assert.equal(command, 'npm');
  assert.deepEqual(args, ['exec', '--no', '--', 'wrangler', 'tail', 'tobirink-public-api', '--config', 'apps/worker/wrangler.jsonc', '--format', 'json']);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.equal(options.detached, true);
  assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
  assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
  assert.equal(options.env.WRANGLER_SEND_ERROR_REPORTS, 'false');
  assert.equal(options.env.WRANGLER_OUTPUT_FILE_PATH, undefined);
  assert.equal(options.env.WRANGLER_OUTPUT_FILE_DIRECTORY, undefined);
  await observer.close();
  await observer.close();
  assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
});

test('complete certificate proves two own admissions and excludes lookups and unrelated traffic', async () => {
  const context = harness({ receive: ({ call, value, emit }) => {
    emit(envelope(identity(100 + Number(call.requestId.slice(-3))), [
      cost({ provider: 'kitsu', acceptedResults: 0, result: 'failed', d1RowsRead: 999999, providerHttpErrors: 3 }),
    ]));
    emit(value);
  } });
  const results = await runObservedDiscoveryCanaries(context.options);
  assert.equal(results.length, 2);
  assert.equal(context.admissions(), 2);
  assert.equal(context.fixture.calls.length, 7);
  const summary = context.reports.at(-1);
  assert.equal(summary.state, 'COMPLETE');
  assert.equal(summary.scope, 'correlated-discovery-requests');
  assert.equal(summary.observedEvents, 2);
  assert.equal(summary.providerRequests, 2);
  assert.equal(summary.acceptedResults, 2);
  assert.equal(summary.d1RowsRead, 30);
  assert.equal(summary.d1RowsWritten, 10);
  assert.deepEqual(context.reports.filter(row => row.type === 'discovery-canary.fixture-cost').map(row => [row.media, row.acceptedResults]), [['ANIME', 1], ['MANGA', 1]]);
  assert.doesNotMatch(JSON.stringify(context.reports), /private|title|https|secret|payload|requestId|00000000/iu);
  assert.deepEqual(context.fake.kills, [[-12345, 'SIGTERM']]);
  assert.equal(context.signals.listenerCount('SIGTERM'), 0);
});

test('delayed exact envelopes prove readiness and each fixture even after the response arrives', async () => {
  const pending = [];
  let waits = 0;
  const context = harness({ receive: ({ value, emit }) => pending.push(() => emit(value)),
    observationWait: () => { waits += 1; if (waits % 2 === 0) pending.splice(0).forEach(deliver => deliver()); } });
  const results = await runObservedDiscoveryCanaries(context.options);
  assert.equal(results.length, 2);
  assert.equal(context.admissions(), 2);
  assert.ok(waits >= 6);
});

test('unrelated lookup cannot establish readiness or launch an admission', async () => {
  const context = harness({ receive: ({ call, emit }) => emit(envelope(identity(100 + Number(call.requestId.slice(-3))), [lookupCost()])) });
  await assert.rejects(runObservedDiscoveryCanaries(context.options), /not-ready/u);
  assert.equal(context.fixture.calls.length, 12);
  assert.equal(context.admissions(), 0);
  assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
});

test('audited false positive with foreign failed Kitsu calls and VERIFIED profiles is rejected', async () => {
  const context = harness({ receive: ({ call, value, emit }) => {
    if (call.url.endsWith('/requests')) {
      emit(envelope(identity(100 + Number(call.requestId.slice(-3))), [
        cost({ provider: 'kitsu', acceptedResults: 0, result: 'failed', providerHttpErrors: 3, d1RowsRead: 999999 }),
      ]));
    } else emit(value);
  } });
  await assert.rejects(runObservedDiscoveryCanaries(context.options), /missing-correlated-cost/u);
  assert.equal(context.admissions(), 1);
  assert.equal(context.reports.at(-1).providerRequests, 0);
  assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
});

test('missing and reused response headers stop without a second admission', async () => {
  for (const mode of ['missing-readiness', 'missing-admission', 'reused-readiness', 'reused-admission']) {
    const context = harness({ receive: ({ call, response, value, emit }) => {
      emit(value);
      if (mode === 'missing-readiness' || mode === 'missing-admission' && call.url.endsWith('/requests')) response.headers.delete('x-tobirink-request-id');
      if (mode === 'reused-readiness' && call.url.endsWith('/requests')) response.headers.set('x-tobirink-request-id', identity(1));
      if (mode === 'reused-admission' && call.body.query?.mediaKind === 'MANGA') response.headers.set('x-tobirink-request-id', identity(3));
    } });
    await assert.rejects(runObservedDiscoveryCanaries(context.options), /invalid-request-id|duplicate-request/u);
    assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
    assert.equal(context.admissions(), mode === 'missing-readiness' ? 0 : mode === 'reused-admission' ? 2 : 1);
  }
});

test('correlated provider and D1 failures stop during observation before a second admission', async () => {
  for (const changes of [{ providerRequests: 0 }, { provider429s: 1 }, { queueFailures: 1 }, { providerHttpErrors: 1 }, { providerNetworkErrors: 1 },
    { acceptedResults: 0 }, { result: 'failed' }, { d1RowsRead: 301 }, { d1RowsRead: undefined }]) {
    let deferred;
    const context = harness({ receive: ({ call, value, emit }) => {
      if (call.url.endsWith('/requests')) deferred = () => emit(envelope(call.requestId, [cost(changes), admissionCost()]));
      else emit(value);
    }, wait: () => deferred?.() });
    await assert.rejects(runObservedDiscoveryCanaries(context.options), /observer-/u);
    assert.equal(context.admissions(), 1);
    assert.equal(context.fixture.calls.length, 3);
    assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
  }
});

test('watch failures at the fixture transition prevent the next HTTP request synchronously', async () => {
  for (const mode of ['tail-error', 'cpu', '429', 'queue']) {
    const context = harness();
    context.options.report = row => {
      context.reports.push(row);
      if (row.type === 'discovery-canary.fixture-cost' && row.media === 'ANIME') {
        if (mode === 'tail-error') context.fake.child.emit('error', new Error('private'));
        if (mode === 'cpu') context.emit(envelope(identity(99), [], { outcome: 'exceededCpu' }));
        if (mode === '429') context.emit(envelope(identity(99), [cost({ provider429s: 1 })]));
        if (mode === 'queue') context.emit(envelope(identity(99), [{ type: 'native-collector.health' }]));
      }
    };
    await assert.rejects(runObservedDiscoveryCanaries(context.options), /observer-/u);
    assert.equal(context.admissions(), 1);
    assert.equal(context.fixture.calls.length, 4);
    assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
  }
});

test('late duplicate envelopes during cleanup invalidate an otherwise complete run', async () => {
  const context = harness();
  context.options.observerFactory = () => startCostObserver({ ...context.fake, killProcess: (pid, signal) => {
    context.emit(envelope(identity(3)));
    context.fake.killProcess(pid, signal);
  } });
  await assert.rejects(runObservedDiscoveryCanaries(context.options), /duplicate-request/u);
  assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
  assert.equal(context.reports.at(-1).observedEvents, 1);
});

test('late truncated frames during cleanup fail closed', async () => {
  const context = harness();
  context.options.observerFactory = () => startCostObserver({ ...context.fake, killProcess: (pid, signal) => {
    context.fake.child.stdout.write('{"logs":[');
    context.fake.killProcess(pid, signal);
  } });
  await assert.rejects(runObservedDiscoveryCanaries(context.options), /truncated/u);
  assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
});

test('HTTP admission 429 fails once without retry or provider certification', async () => {
  const context = harness({ fixtureOptions: { admissionStatus: 429 } });
  await assert.rejects(runObservedDiscoveryCanaries(context.options), /submit-http-429/u);
  assert.equal(context.admissions(), 1);
  assert.equal(context.reports.at(-1).observedEvents, 0);
});

test('wall-clock budget and interruption abort mocked work and remove signal handlers', async () => {
  for (const mode of ['budget', 'signal']) {
    const context = harness({ budgetMs: 5 });
    context.options.observationWait = () => {
      if (mode === 'signal') context.signals.emit('SIGTERM');
      return new Promise(() => {});
    };
    await assert.rejects(runObservedDiscoveryCanaries(context.options), /observer-budget|observer-interrupted/u);
    assert.equal(context.admissions(), 0);
    assert.deepEqual(context.fake.kills, [[-12345, 'SIGTERM']]);
    assert.equal(context.signals.listenerCount('SIGTERM'), 0);
    assert.equal(context.signals.listenerCount('SIGINT'), 0);
  }
});

test('an unexpected tail exit stops before any admission', async () => {
  const context = harness({ receive: ({ fake }) => { fake.child.stdout.end(); fake.child.emit('close', 1); } });
  await assert.rejects(runObservedDiscoveryCanaries(context.options), /observer-exited/u);
  assert.equal(context.admissions(), 0);
  assert.equal(context.reports.at(-1).state, 'INCOMPLETE');
  assert.equal(context.fake.kills.length, 0);
});

test('an unresponsive child is force-closed only in the recorded group', async () => {
  const fake = fakeTail();
  const observer = startCostObserver({ ...fake, killProcess: (pid, signal) => {
    fake.kills.push([pid, signal]);
    if (signal === 'SIGKILL') { fake.child.stdout.end(); fake.child.emit('close', null); }
  } });
  await observer.close();
  assert.deepEqual(fake.kills, [[-12345, 'SIGTERM'], [-12345, 'SIGKILL']]);
});

test('CLI errors are closed codes, including hostile errors imitating the prefix', () => {
  for (const suffix of ['submit-http-429', 'observer-not-ready', 'observer-missing-correlated-cost', 'observer-duplicate-request', 'observer-d1-budget']) {
    assert.equal(canaryFailureCode(new Error('discovery-canary-' + suffix)), 'discovery-canary-' + suffix);
  }
  for (const message of ['private-secret', 'discovery-canary-private-secret', 'https://private.invalid', 'discovery-canary-observer-failed\nprivate']) {
    assert.equal(canaryFailureCode(new Error(message)), 'discovery-canary-failed');
  }
});
