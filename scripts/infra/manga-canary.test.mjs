/* global Response */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { canaryFailureCode, createCostObservation, runDiscoveryCanaries, runObservedDiscoveryCanaries, startCostObserver } from './manga-canary.mjs';

function fixtureFetcher({ initial = 'MISS', admission = 'PENDING', terminal = 'VERIFIED', admissionStatus = 202, wrongReference = false } = {}) {
  const admitted = new Map();
  const calls = [];
  return {
    calls,
    async fetcher(url, init) {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url.endsWith('/requests')) {
        admitted.set(body.key.fingerprint, body.query);
        return Response.json({ state: admission }, { status: admissionStatus });
      }
      const key = body.keys[0];
      const query = admitted.get(key.fingerprint);
      const state = query === undefined ? { state: initial } : terminal === 'VERIFIED'
        ? { state: terminal, profile: {
          candidate: { mediaKind: key.mediaKind, titles: query.sourceTitles },
          references: [{ ...query.explicitProviderReference, externalId: wrongReference ? '1' : query.explicitProviderReference.externalId }],
        } } : { state: terminal };
      return Response.json([{ key, state }]);
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

function cost(overrides = {}) {
  return { schemaVersion: 1, type: 'worker.cost', task: 'discovery', provider: 'anilist', result: 'changed',
    pagesRequested: 0, providerRequests: 2, acceptedResults: 1, durationMs: 80, retries: 1,
    providerTransportDurationMs: 60, provider429s: 1, providerHttpErrors: 1, providerNetworkErrors: 0,
    d1RowsRead: 10, d1RowsWritten: 3, queueSends: 1, queueFailures: 0, ...overrides };
}

function tailFrame(...events) {
  return JSON.stringify({ event: { request: { url: 'https://private.invalid', headers: { authorization: 'private-secret' } } },
    logs: [{ message: ['private title and payload', ...events.map(row => JSON.stringify(row))] }],
    exceptions: [{ message: 'private error' }] }, null, 4) + '\n';
}

test('chunked pretty JSON and UTF-8 are aggregated with a closed, redacted Discovery summary', () => {
  const observation = createCostObservation();
  const bytes = Buffer.from('CLI banner é\n' + tailFrame(cost({ title: 'private } \\" title é', url: 'https://private.invalid' }))
    + tailFrame(cost({ task: 'agenda', providerRequests: 900 }), cost({ task: 'discovery-lookup', provider: 'none', providerRequests: 0 })));
  for (const byte of bytes) observation.push(Buffer.from([byte]));
  observation.finish();
  const summary = observation.snapshot();
  assert.equal(summary.observedEvents, 2);
  assert.equal(summary.providerRequests, 2);
  assert.equal(summary.provider429s, 2);
  assert.equal(summary.providerTransportDurationMs, 120);
  assert.equal(summary.d1RowsRead, 20);
  assert.equal(summary.queueSends, 2);
  assert.equal(summary.retries, 2);
  assert.equal(summary.results.changed, 2);
  assert.doesNotMatch(JSON.stringify(summary), /private|title|url|https|authorization|secret|payload|exceptions/iu);
});

test('observer rejects malformed costs, truncated frames and more than 1 MiB without leaking content', () => {
  for (const overrides of [{ providerRequests: -1 }, { provider: 'private-secret' }, { provider429s: 0.5 }, { providerTransportDurationMs: undefined }]) {
    const observation = createCostObservation();
    assert.throws(() => observation.push(tailFrame(cost(overrides))), /^Error: discovery-canary-observer-invalid-cost$/u);
  }
  const truncated = createCostObservation();
  truncated.push('{"logs":[');
  assert.throws(() => truncated.finish(), /observer-truncated/u);
  const overflow = createCostObservation();
  assert.throws(() => overflow.push(Buffer.alloc(1024 * 1024 + 1)), /observer-byte-limit/u);
});

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

test('tail uses only the pinned npm command, discards stderr, disables disk logs and closes its own group', async () => {
  const fake = fakeTail();
  const observer = startCostObserver(fake);
  fake.child.stdout.write(tailFrame(cost()));
  assert.equal(observer.snapshot().providerRequests, 2);
  const [command, args, options] = fake.launches[0];
  assert.equal(command, 'npm');
  assert.deepEqual(args, ['exec', '--no', '--', 'wrangler', 'tail', 'tobirink-public-api', '--config', 'apps/worker/wrangler.jsonc', '--format', 'json', '--search', 'worker.cost']);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.equal(options.detached, true);
  assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
  assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
  assert.equal(options.env.WRANGLER_OUTPUT_FILE_PATH, undefined);
  assert.equal(options.env.WRANGLER_OUTPUT_FILE_DIRECTORY, undefined);
  await observer.close();
  await observer.close();
  assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
});

test('observed canaries start the observer first and certify only measured provider traffic', async () => {
  const fake = fakeTail();
  const fixture = fixtureFetcher();
  const reports = [];
  let waits = 0;
  const signals = new EventEmitter();
  const results = await runObservedDiscoveryCanaries({
    fetcher: async (...args) => { assert.equal(fake.launches.length, 1); return fixture.fetcher(...args); },
    wait: () => {}, report: row => reports.push(row), signals,
    observerFactory: () => startCostObserver(fake),
    observationWait: () => {
      waits += 1;
      if (waits === 2) fake.child.stdout.write(tailFrame(cost({ provider429s: 0 })));
      if (waits === 3) fake.child.stdout.write(tailFrame(cost({ provider: 'mangaupdates', provider429s: 0 })));
    },
  });
  assert.equal(results.length, 2);
  assert.equal(waits, 4);
  assert.equal(reports.at(-1).state, 'COMPLETE');
  assert.equal(reports.at(-1).scope, 'discovery-traffic-window');
  assert.equal(reports.at(-1).providerRequests, 4);
  assert.deepEqual(reports.filter(row => row.type === 'discovery-canary.fixture-cost').map(row => [row.media, row.providerRequests]), [['ANIME', 2], ['MANGA', 2]]);
  assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.doesNotMatch(JSON.stringify(reports), /private|title|https|secret|payload/iu);
});

test('a missing first-fixture provider call stops before the manga admission', async () => {
  const fake = fakeTail();
  const fixture = fixtureFetcher();
  await assert.rejects(runObservedDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {},
    observerFactory: () => startCostObserver(fake), observationWait: () => {},
  }), /observer-no-provider-calls/u);
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
});

test('a provider 429 or Queue failure stops before the second admission', async () => {
  for (const [field, code] of [['provider429s', 'provider-429'], ['queueFailures', 'queue-failure']]) {
    const fake = fakeTail();
    const fixture = fixtureFetcher();
    let waits = 0;
    await assert.rejects(runObservedDiscoveryCanaries({ fetcher: fixture.fetcher, wait: () => {}, report: () => {},
      observerFactory: () => startCostObserver(fake), observationWait: () => {
        if (++waits === 2) fake.child.stdout.write(tailFrame(cost({ provider429s: 0, [field]: 1 })));
      },
    }), new RegExp(`observer-${code}`, 'u'));
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/requests')).length, 1);
  }
});

test('empty observer or no provider calls fails certification and always closes the child', async () => {
  for (const rows of [[], [cost({ provider: 'none', providerRequests: 0 })]]) {
    const fake = fakeTail();
    const fixture = fixtureFetcher();
    const reports = [];
    await assert.rejects(runObservedDiscoveryCanaries({ ...fixture, wait: () => {}, report: row => reports.push(row),
      observerFactory: () => startCostObserver(fake), observationWait: () => { if (rows.length) fake.child.stdout.write(tailFrame(...rows)); },
    }), /observer-no-events|observer-no-provider-calls/u);
    assert.equal(reports.at(-1).state, 'INCOMPLETE');
    assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
  }
});

test('canary failure and observer exit abort certification, redact errors and clean up', async () => {
  for (const failure of ['canary', 'observer']) {
    const fake = fakeTail();
    const fixture = fixtureFetcher({ admissionStatus: 429 });
    const reports = [];
    await assert.rejects(runObservedDiscoveryCanaries({ ...fixture, wait: () => {}, report: row => reports.push(row),
      observerFactory: () => startCostObserver(fake), observationWait: () => {
        if (failure === 'observer') fake.child.emit('error', new Error('private secret url https://private.invalid'));
      },
    }), failure === 'observer' ? /observer-failed/u : /submit-http-429/u);
    assert.equal(reports.at(-1).state, 'INCOMPLETE');
    assert.doesNotMatch(JSON.stringify(reports), /private|https|secret/iu);
    assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
  }
});

test('wall-clock budget and interruption abort ongoing work and remove signal handlers', async () => {
  for (const mode of ['budget', 'signal']) {
    const fake = fakeTail();
    const signals = new EventEmitter();
    await assert.rejects(runObservedDiscoveryCanaries({ report: () => {}, signals, budgetMs: 5,
      observerFactory: () => startCostObserver(fake), observationWait: () => {
        if (mode === 'signal') signals.emit('SIGTERM');
        return new Promise(() => {});
      },
    }), /observer-budget|observer-interrupted/u);
    assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    assert.equal(signals.listenerCount('SIGINT'), 0);
  }
});

test('HTTP refresh costs need no transport fields, unlike actual Queue provider work', () => {
  const observation = createCostObservation();
  observation.push(tailFrame({ schemaVersion: 1, type: 'worker.cost', task: 'discovery-refresh', provider: 'none', result: 'changed',
    pagesRequested: 0, providerRequests: 0, acceptedResults: 0, durationMs: 3, retries: 0, d1RowsRead: 4, d1RowsWritten: 1 }));
  observation.finish();
  assert.equal(observation.snapshot().observedEvents, 1);
  assert.equal(observation.snapshot().providerTransportDurationMs, 0);
});

test('late invalid or truncated logs during termination prevent a complete certificate', async () => {
  for (const late of ['{"logs":[', tailFrame(cost({ providerRequests: -1 }))]) {
    const fake = fakeTail();
    const fixture = fixtureFetcher();
    const reports = [];
    const observerFactory = () => startCostObserver({ ...fake, killProcess: (pid, signal) => {
      fake.child.stdout.write(late);
      fake.killProcess(pid, signal);
    } });
    let waits = 0;
    await assert.rejects(runObservedDiscoveryCanaries({ ...fixture, wait: () => {}, report: row => reports.push(row), observerFactory,
      observationWait: () => { if (++waits === 2 || waits === 3) fake.child.stdout.write(tailFrame(cost({ provider429s: 0 }))); },
    }), /observer-truncated|observer-invalid-cost/u);
    assert.equal(reports.at(-1).state, 'INCOMPLETE');
    assert.deepEqual(fake.kills, [[-12345, 'SIGTERM']]);
  }
});

test('CLI errors are closed codes, including a hostile error imitating their prefix', () => {
  assert.equal(canaryFailureCode(new Error('discovery-canary-submit-http-429')), 'discovery-canary-submit-http-429');
  for (const message of ['private-secret', 'discovery-canary-private-secret', 'https://private.invalid', 'discovery-canary-observer-failed\nprivate']) {
    assert.equal(canaryFailureCode(new Error(message)), 'discovery-canary-failed');
  }
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

test('an unexpected tail exit fails immediately without certifying or launching requests', async () => {
  const fake = fakeTail();
  const fixture = fixtureFetcher();
  const reports = [];
  await assert.rejects(runObservedDiscoveryCanaries({ ...fixture, report: row => reports.push(row),
    observerFactory: () => startCostObserver(fake), observationWait: () => {
      fake.child.stdout.end(); fake.child.emit('close', 1);
      return new Promise(() => {});
    },
  }), /observer-exited/u);
  assert.equal(fixture.calls.length, 0);
  assert.equal(reports.at(-1).state, 'INCOMPLETE');
  assert.equal(fake.kills.length, 0);
});
