import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInstalledRecoveryObservation, createInstalledReviewNetworkGuard, installInstalledReviewNetworkRoutes, readInstalledReviewSubmissions } from './installed-review-network.mjs';
import { assertInstalledReviewExtensionSurface } from './installed-review-surface.mjs';
import { assertInstalledReviewProfileRoot, createInstalledReviewProfileRoot, drainInstalledReviewReads, prepareInstalledRecoveryRestart, reloadInstalledReviewExtension, restartInstalledReviewWorker, summarizeInstalledDiagnosticFailures } from './installed-review.mjs';
import { reserveRecoveryPost } from '../../../scripts/infra/discovery-recovery-batch.mjs';

describe('persistent installed review profiles', () => {
  const persistentRoot = fileURLToPath(new URL('../../../build/installed-review/profiles/', import.meta.url));
  const token = 'tobirink-installed-review-Abc123';

  it('creates private stable profiles without replacing an existing profile', async () => {
    const first = await createInstalledReviewProfileRoot();
    await writeFile(join(first, 'preserved-fixture.json'), '{"preserved":true}', { mode: 0o600 });
    const second = await createInstalledReviewProfileRoot();
    expect(dirname(first)).toBe(dirname(join(persistentRoot, token)));
    expect(dirname(second)).toBe(dirname(join(persistentRoot, token)));
    expect(first).not.toBe(second);
    expect((await stat(first)).mode & 0o077).toBe(0);
    expect((await stat(second)).mode & 0o077).toBe(0);
    expect((await stat(persistentRoot)).mode & 0o077).toBe(0);
    expect(await readFile(join(first, 'preserved-fixture.json'), 'utf8')).toBe('{"preserved":true}');
    expect(() => assertInstalledReviewProfileRoot(first, basename(first))).not.toThrow();
  });

  it('accepts the stable path and legacy temporary path without moving either', () => {
    expect(() => assertInstalledReviewProfileRoot(join(persistentRoot, token), token)).not.toThrow();
    expect(() => assertInstalledReviewProfileRoot(join(tmpdir(), token), token)).not.toThrow();
  });

  it.each([
    [join(persistentRoot, 'foreign'), token],
    [join(tmpdir(), 'foreign', token), token],
    [join(persistentRoot, token), '../' + token],
    [join(persistentRoot, token), 'tobirink-installed-review-../Abc123'],
  ])('rejects foreign profile paths or unsafe tokens', (root, sessionToken) => {
    expect(() => assertInstalledReviewProfileRoot(root, sessionToken)).toThrow();
  });
});

describe('installed recovery restart preparation', () => {
  it('waits for correlation before pausing and draining live routes', async () => {
    const events = [];
    let complete;
    const completion = new Promise(resolve => { complete = resolve; });
    const observer = { finish: vi.fn(async () => { await completion; events.push('correlated'); return ['cost']; }) };
    const page = { getByRole: vi.fn(() => ({ click: async () => { events.push('paused'); } })) };
    const guard = { closeReadPhase: () => { events.push('reads-closed'); }, drain: async () => { events.push('drained'); }, throwIfFailed: () => { events.push('checked'); } };
    const pending = prepareInstalledRecoveryRestart(page, guard, observer, 10);
    await Promise.resolve();
    expect(events).toEqual([]);
    complete();
    await expect(pending).resolves.toEqual(['cost']);
    expect(observer.finish).toHaveBeenCalledWith(10);
    expect(events).toEqual(['correlated', 'reads-closed', 'paused', 'drained', 'checked']);
    expect(page.getByRole).toHaveBeenCalledWith('button', { name: 'Mettre en pause', exact: true });
  });

  it('does not proceed to a restart after correlation failure', async () => {
    const page = { getByRole: vi.fn() };
    const guard = { drain: vi.fn() };
    await expect(prepareInstalledRecoveryRestart(page, guard, { finish: async () => { throw new Error('late-failure'); } }, 10)).rejects.toThrow('late-failure');
    expect(page.getByRole).not.toHaveBeenCalled();
    expect(guard.drain).not.toHaveBeenCalled();
  });
});

describe('installed upgrade reload', () => {
  const extensionId = 'a'.repeat(32);
  function fixture(enabled = 'true', health = true) {
    const developer = { getAttribute: vi.fn(async () => enabled), click: vi.fn() };
    const reload = { click: vi.fn(), waitFor: vi.fn() };
    const page = { goto: vi.fn(), evaluate: vi.fn(async () => ({ ok: health })),
      locator: vi.fn(selector => selector === '#devMode' ? developer : reload) };
    return { page, developer, reload };
  }
  it.each(['true', 'false'])('reloads the exact extension with developer mode %s', async enabled => {
    const { page, developer, reload } = fixture(enabled);
    await reloadInstalledReviewExtension(page, extensionId);
    expect(page.goto.mock.calls).toEqual([['chrome://extensions/'], [`chrome-extension://${extensionId}/options.html`]]);
    expect(developer.click).toHaveBeenCalledTimes(enabled === 'true' ? 0 : 1);
    expect(page.locator).toHaveBeenCalledWith(`extensions-item[id="${extensionId}"] #dev-reload-button`);
    expect(reload.click).toHaveBeenCalledOnce();
    expect(reload.waitFor).toHaveBeenCalledWith({ state: 'visible' });
    expect(page.evaluate).toHaveBeenCalledOnce();
  });
  it('refuses a malformed identity before opening browser settings', async () => {
    const { page } = fixture();
    await expect(reloadInstalledReviewExtension(page, 'invalid')).rejects.toThrow('complete Chrome extension identity');
    expect(page.goto).not.toHaveBeenCalled();
  });
  it('does not certify a reload when its UI action fails', async () => {
    const { page, reload } = fixture();
    reload.click.mockRejectedValue(new Error('reload-failed'));
    await expect(reloadInstalledReviewExtension(page, extensionId)).rejects.toThrow('reload-failed');
    expect(page.evaluate).not.toHaveBeenCalled();
  });
  it('requires a healthy runtime after reload', async () => {
    const { page } = fixture('true', false);
    await expect(reloadInstalledReviewExtension(page, extensionId)).rejects.toThrow('must answer its health check');
  });
});

describe('installed diagnostic failure sample', () => {
  it('bounds the sample and emits only closed codes and operations', () => {
    const failures = Array.from({ length: 110 }, () => ({ outcome: 'failed', operation: 'provider-result', code: 'DISCOVERY_CANDIDATE_SCHEMA_INVALID', title: 'PRIVATE_TITLE' }));
    const result = summarizeInstalledDiagnosticFailures({ events: [...failures,
      { outcome: 'failed', operation: 'PRIVATE_OPERATION', code: 'PRIVATE_CODE', url: 'https://private.invalid' },
      { outcome: 'complete', operation: 'resolution-commit', code: 'VERIFIED' },
    ] });
    expect(result).toEqual({ windowLimit: 100, sampledEvents: 100, failures: [
      { operation: 'provider-result', code: 'DISCOVERY_CANDIDATE_SCHEMA_INVALID', count: 98 },
      { operation: 'other', code: 'OTHER_FAILURE', count: 1 },
    ] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|private\.invalid/u);
  });

  it('does not treat missing diagnostics as a zero-error certificate', () => {
    expect(summarizeInstalledDiagnosticFailures(undefined)).toEqual({ windowLimit: 100, sampledEvents: 0, failures: [] });
  });
});

const key = (index = 1) => ({
  fingerprint: index.toString(16).padStart(64, '0'),
  mediaKind: 'MANGA',
  parserVersion: 'parser-v1',
  siteRulesVersion: 'rules-v1',
});
const query = { discoveryTitles: ['Bounded title'], mediaKind: 'MANGA', sourceTitles: [] };

describe('sealed installed admissions', () => {
  const submission = index => ({ key: key(index), query, schemaVersion: 3 });
  const sourceScope = () => ({ corpusDigest: 'a'.repeat(64), sourceCount: 1522, schemaVersion: 1,
    entries: Array.from({ length: 10 }, (_value, index) => ({ key: key(index + 1),
      requestDigest: createHash('sha256').update(JSON.stringify(submission(index + 1))).digest('hex') })) });
  const request = body => fakeRoute({ body, method: 'POST', status: 202, url: 'https://tobirink.com/v3/catalogue/discoveries/requests' });

  it('forwards exactly ten sealed identities with 45-second POSTs and shared CLI reservations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tobirink-shared-recovery-'));
    const recoveryReceiptDirectory = pathToFileURL(directory + '/');
    const { instance } = await guard({ sourceScope: sourceScope(), recoveryReceiptDirectory, mutationBudget: 10, online: true });
    for (let index = 1; index <= 10; index += 1) {
      const route = request(submission(index));
      await instance.handle(route);
      expect(route.fetch).toHaveBeenCalledWith({ maxRedirects: 0, maxRetries: 0, timeout: 45_000 });
      expect(route.fulfill).toHaveBeenCalledOnce();
      await expect(reserveRecoveryPost(sourceScope().entries[index - 1], recoveryReceiptDirectory)).rejects.toThrow('post-reservation-failed');
    }
    expect(instance.snapshot()).toMatchObject({ forwardedRequests: 10, receipts: 10 });
    const extra = request(submission(11));
    await instance.handle(extra);
    expect(extra.fetch).not.toHaveBeenCalled();
  });

  it('waits for each correlation before forwarding the next admission and stops on failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tobirink-sequential-recovery-'));
    const recoveryReceiptDirectory = pathToFileURL(directory + '/');
    let releaseFirst;
    let firstObserved;
    const firstAdmissionObserved = new Promise(resolve => { firstObserved = resolve; });
    const firstAdmissionGate = new Promise(resolve => { releaseFirst = resolve; });
    const onFailure = vi.fn(async () => undefined);
    const onAdmission = vi.fn(async (_submission, response) => {
      if (response.status() === 202 && onAdmission.mock.calls.length === 1) {
        firstObserved();
        await firstAdmissionGate;
        throw new Error('correlation-failed');
      }
    });
    const { instance } = await guard({ sourceScope: sourceScope(), recoveryReceiptDirectory,
      mutationBudget: 10, online: true, onAdmission, onFailure });
    const first = request(submission(1));
    const second = request(submission(2));
    const firstHandling = instance.handle(first);
    await firstAdmissionObserved;
    const secondHandling = instance.handle(second);
    await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(first.fetch).toHaveBeenCalledOnce();
    expect(second.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ forwardedRequests: 1, receipts: 1 });
    releaseFirst();
    await Promise.all([firstHandling, secondHandling]);
    expect(first.abort).toHaveBeenCalledOnce();
    expect(second.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ failure: 'correlation-failed', forwardedRequests: 1, receipts: 1 });
    expect(onAdmission).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it('forwards a queued admission only after the preceding correlation succeeds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tobirink-correlation-gate-'));
    const recoveryReceiptDirectory = pathToFileURL(directory + '/');
    let releaseFirst;
    let firstObserved;
    const firstAdmissionObserved = new Promise(resolve => { firstObserved = resolve; });
    const firstAdmissionGate = new Promise(resolve => { releaseFirst = resolve; });
    const onAdmission = vi.fn(async () => {
      if (onAdmission.mock.calls.length === 1) {
        firstObserved();
        await firstAdmissionGate;
      }
    });
    const { instance } = await guard({ sourceScope: sourceScope(), recoveryReceiptDirectory,
      mutationBudget: 10, online: true, onAdmission });
    const first = request(submission(1));
    const second = request(submission(2));
    const firstHandling = instance.handle(first);
    await firstAdmissionObserved;
    const secondHandling = instance.handle(second);
    await new Promise(resolve => { setTimeout(resolve, 0); });
    expect(second.fetch).not.toHaveBeenCalled();
    releaseFirst();
    await Promise.all([firstHandling, secondHandling]);
    expect(first.fetch).toHaveBeenCalledOnce();
    expect(second.fetch).toHaveBeenCalledOnce();
    expect(instance.snapshot()).toMatchObject({ failure: undefined, forwardedRequests: 2, receipts: 2 });
    expect(onAdmission).toHaveBeenCalledTimes(2);
  });

  it('rejects wrong complete keys and payload drift before reserving or forwarding', async () => {
    for (const body of [submission(11), { ...submission(1), key: { ...key(1), parserVersion: 'other' } },
      { ...submission(1), query: { ...query, discoveryTitles: ['Changed'] } }]) {
      const directory = await mkdtemp(join(tmpdir(), 'tobirink-scope-rejection-'));
      const { instance } = await guard({ sourceScope: sourceScope(), recoveryReceiptDirectory: pathToFileURL(directory + '/'), mutationBudget: 10, online: true });
      const route = request(body);
      await instance.handle(route);
      expect(route.fetch).not.toHaveBeenCalled();
      expect(await readdir(directory)).toEqual([]);
      expect(instance.snapshot().failure).toBe('mutation-scope-rejected');
    }
  });

  it('keeps failed submissions consumed across sessions and refuses unscoped expansion', async () => {
    await expect(guard({ mutationBudget: 10, online: true })).rejects.toThrow('scope');
    const directory = await mkdtemp(join(tmpdir(), 'tobirink-interrupted-recovery-'));
    const recoveryReceiptDirectory = pathToFileURL(directory + '/');
    const options = { sourceScope: sourceScope(), recoveryReceiptDirectory, mutationBudget: 10, online: true };
    const first = await guard(options);
    const failed = request(submission(1));
    failed.fetch.mockRejectedValue(new Error('Interrupted'));
    await first.instance.handle(failed);
    const resumed = await guard(options);
    const replay = request(submission(1));
    await resumed.instance.handle(replay);
    expect(replay.fetch).not.toHaveBeenCalled();
    expect(resumed.instance.snapshot().failure).toBe('mutation-receipt-failed');
  });
});

describe('installed recovery correlation', () => {
  const requestId = '00000000-0000-4000-8000-000000000001';
  it('closes an unready observer before any admission after the startup deadline', async () => {
    vi.useFakeTimers();
    const observer = { failed: new Promise(() => {}), close: vi.fn(async () => undefined) };
    try {
      const pending = createInstalledRecoveryObservation({ start: () => observer,
        ready: async (_observer, signal) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('startup-aborted')), { once: true });
        }), onFailure: vi.fn() });
      const failure = expect(pending).rejects.toThrow('startup-aborted');
      await vi.advanceTimersByTimeAsync(75_000);
      await failure;
      expect(observer.close).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  async function fixture(overrides = {}, recoveryBatchSize = 1) {
    const cost = { providerRequests: 1, acceptedResults: 1, provider429s: 0, providerHttpErrors: 0,
      providerNetworkErrors: 0, queueFailures: 0, d1RowsRead: 200, d1RowsWritten: 20, ...overrides };
    const observer = { failed: new Promise(() => {}), check: vi.fn(), close: vi.fn(async () => undefined),
      track: vi.fn(), read: vi.fn(() => cost) };
    const ready = vi.fn(async () => undefined);
    const complete = vi.fn(async () => ({ cost, terminal: { state: 'VERIFIED' } }));
    const recordCost = vi.fn(async () => undefined);
    const start = vi.fn(() => observer);
    const observation = await createInstalledRecoveryObservation({ start, recoveryBatchSize, ready, complete, recordCost, onFailure: vi.fn() });
    const response = { headers: () => ({ 'x-tobirink-request-id': requestId }), text: async () => JSON.stringify({ state: 'PENDING' }) };
    return { observation, response, observer, ready, complete, recordCost, start };
  }

  it('passes the sealed batch size to the observer before admission', async () => {
    const context = await fixture({}, 10);
    expect(context.start).toHaveBeenCalledExactlyOnceWith({ allowProviderContinuation: true, recoveryBatchSize: 10 });
    expect(context.observer.track).not.toHaveBeenCalled();
    await context.observation.close();
  });

  it('starts observation before admission and checkpoints its cost before the next admission', async () => {
    const context = await fixture();
    expect(context.ready).toHaveBeenCalledOnce();
    expect(context.complete).not.toHaveBeenCalled();
    await context.observation.onAdmission({ key: key() }, context.response);
    expect(context.complete).toHaveBeenCalledOnce();
    expect(context.recordCost).toHaveBeenCalledWith({ requestId, cost: context.observer.read(requestId) });
    expect(context.observer.track).toHaveBeenCalledWith(requestId, { provider: 'any', status: 202, task: 'discovery' });
    expect(await context.observation.finish(1)).toEqual([{ providerRequests: 1, d1RowsRead: 200, d1RowsWritten: 20 }]);
    expect(context.observer.close).toHaveBeenCalledOnce();
    await context.observation.close();
  });

  it('rejects certification when the durable cost checkpoint fails', async () => {
    const context = await fixture();
    context.recordCost.mockRejectedValue(new Error('checkpoint-failed'));
    await expect(context.observation.onAdmission({ key: key() }, context.response)).rejects.toThrow('checkpoint-failed');
    expect(context.observation.failureCode()).toBe('discovery-recovery-failed');
    await context.observation.close();
  });

  it.each([
    ['discovery-canary-observer-d1-budget', 'discovery-canary-observer-d1-budget'],
    ['discovery-canary-observer-invalid-frame', 'discovery-canary-observer-invalid-frame'],
    ['discovery-canary-observer-count-limit', 'discovery-canary-observer-count-limit'],
    ['private-title', 'discovery-recovery-failed'],
    ['discovery-canary-observer-private-title', 'discovery-recovery-failed'],
  ])('records a safe correlation failure for %s', async (message, expected) => {
    let rejectFailure;
    const failed = new Promise((_resolve, reject) => { rejectFailure = reject; });
    const observer = { failed, check: vi.fn(), close: vi.fn(async () => undefined), track: vi.fn(), read: vi.fn() };
    const onFailure = vi.fn();
    const observation = await createInstalledRecoveryObservation({ start: () => observer, ready: async () => undefined,
      complete: vi.fn(), onFailure });
    rejectFailure(new Error(message));
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
    expect(observation.failureCode()).toBe(expected);
    await observation.close();
  });

  it('retains only validated aggregate evidence for a D1 budget failure', async () => {
    const evidence = { acceptedResults: 0, admissionD1RowsRead: 30, collectorD1RowsRead: 271,
      collectorEvents: 2, d1RowsRead: 301, d1RowsWritten: 6, providers: ['anilist'],
      providerRequests: 2, queueFailures: 0, queueSends: 1, retries: 0, results: ['failed', 'changed'] };
    let rejectFailure;
    const failed = new Promise((_resolve, reject) => { rejectFailure = reject; });
    const observer = { failed, check: vi.fn(), close: vi.fn(async () => undefined), track: vi.fn(), read: vi.fn(), failureEvidence: () => evidence };
    const observation = await createInstalledRecoveryObservation({ start: () => observer, ready: async () => undefined,
      complete: vi.fn(), onFailure: vi.fn() });
    rejectFailure(new Error('discovery-canary-observer-d1-budget'));
    await vi.waitFor(() => expect(observation.failureCode()).toBe('discovery-canary-observer-d1-budget'));
    expect(observation.failureEvidence()).toEqual(evidence);
    expect(JSON.stringify(observation.failureEvidence())).not.toMatch(/fingerprint|requestId|title|url/iu);
    await observation.close();
  });

  it('rejects missing, duplicate or incomplete admission correlations', async () => {
    const context = await fixture();
    await expect(context.observation.onAdmission({ key: key() }, { ...context.response, headers: () => ({}) })).rejects.toThrow();
    await context.observation.onAdmission({ key: key() }, context.response);
    await expect(context.observation.onAdmission({ key: key(2) }, context.response)).rejects.toThrow('unique');
    await expect(context.observation.finish(2)).rejects.toThrow('Every scoped admission');
    await context.observation.close();
  });

  it('rejects provider-free, over-budget and late-error observations', async () => {
    for (const cost of [{ providerRequests: 0 }, { d1RowsRead: 301 }, { provider429s: 1 }, { queueFailures: 1 }]) {
      const context = await fixture(cost);
      await expect(context.observation.onAdmission({ key: key() }, context.response)).rejects.toThrow('cost policy');
      expect(context.recordCost).not.toHaveBeenCalled();
      await context.observation.close();
    }
    const context = await fixture();
    await context.observation.onAdmission({ key: key() }, context.response);
    context.observer.close.mockImplementation(async () => {
      context.observer.check.mockImplementation(() => { throw new Error('late-queue-error'); });
    });
    await expect(context.observation.finish(1)).rejects.toThrow('late-queue-error');
    await context.observation.close();
  });
});

function fakeRoute({ body, fetchError, headers, method = 'GET', onAbort, onFetch, onHeaders, status = 200, url }) {
  const response = { status: () => status };
  const requestHeaders = headers ?? (body === undefined
    ? { accept: 'application/json', 'user-agent': 'Chromium/153 installed-review' }
    : { accept: 'application/json', 'content-type': 'application/json', origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user-agent': 'Chromium/153 installed-review' });
  const request = { allHeaders: async () => { await onHeaders?.(); return requestHeaders; }, method: () => method, postData: () => body === undefined ? null : JSON.stringify(body), url: () => url };
  return {
    abort: vi.fn(async () => { await onAbort?.(); }),
    continue: vi.fn(async () => undefined),
    fetch: vi.fn(async (options) => {
      await onFetch?.(options);
      if (fetchError) throw new Error('bounded-fetch-failure');
      return response;
    }),
    fulfill: vi.fn(async () => undefined),
    request: () => request,
  };
}

async function guard(overrides = {}) {
  const receiptRoot = overrides.receiptRoot ?? await mkdtemp(join(tmpdir(), 'tobirink-network-guard-'));
  const onFailure = overrides.onFailure ?? vi.fn(async () => undefined);
  return {
    instance: await createInstalledReviewNetworkGuard({
      mutationBudget: 0,
      captureSubmissions: false,
      onFailure,
      online: false,
      readBudget: 0,
      receiptRoot,
      refreshBudget: 0,
      token: 'tobirink-installed-review-Abc123',
      ...overrides,
    }),
    onFailure,
    receiptRoot,
  };
}

function discoveryUrl(input = key()) {
  const url = new URL('https://tobirink.com/v3/catalogue/discoveries');
  for (const [name, value] of Object.entries(input)) url.searchParams.set(name, value);
  return url.toString();
}

async function writeManifest(root, policy, overrides = {}) {
  await writeFile(join(root, 'manifest.json'), JSON.stringify({
    action: { default_icon: {}, default_popup: 'popup.html', default_title: 'Tobirink' },
    background: { service_worker: 'background.js', type: 'module' },
    content_security_policy: { extension_pages: policy },
    content_scripts: [{ js: ['content-scripts/web-bridge.js'], matches: ['https://tobirink.com/*'], run_at: 'document_start' }],
    description: 'Private library',
    externally_connectable: { matches: ['https://tobirink.com/*'] },
    host_permissions: ['https://tobirink.com/*'],
    icons: {},
    manifest_version: 3,
    minimum_chrome_version: '140',
    name: 'Tobirink',
    options_ui: { open_in_tab: true, page: 'options.html' },
    permissions: ['storage', 'bookmarks', 'alarms', 'notifications', 'activeTab'],
    version: '1.0.44',
    ...overrides,
  }));
}

function restartFixture(overrides = {}) {
  const session = new EventEmitter();
  const emit = (state, version = overrides.version) => session.emit('ServiceWorker.workerVersionUpdated', { versions: [{ scriptURL: 'chrome-extension://fixture/background.js', versionId: 'version-1', runningStatus: state, ...version }] });
  session.send = vi.fn(async (method) => {
    if (overrides.failMethod === method) throw new Error('protocol-failed');
    if (overrides.hangMethod === method) return new Promise(() => {});
    if (method === 'ServiceWorker.enable') {
      if (!overrides.omitInitial) emit('running');
    } else if (method === 'ServiceWorker.stopWorker') {
      for (const state of overrides.stopStates ?? ['stopping', 'stopped']) emit(state, overrides.stopVersion ?? overrides.version);
    } else throw new Error('unexpected-protocol-method');
    return { success: true };
  });
  session.detach = vi.fn(async () => undefined);
  const context = { newCDPSession: vi.fn(async () => session) };
  const page = { evaluate: vi.fn(async () => {
    if (overrides.wakeError) throw new Error('wake-failed');
    for (const state of overrides.wakeStates ?? ['starting', 'running']) emit(state);
    return { ok: overrides.healthOk ?? true };
  }) };
  return { context, page, session };
}

describe('installed review service-worker restart evidence', () => {
  it('requires running then stopped then running for the same extension version', async () => {
    const fixture = restartFixture();
    await expect(restartInstalledReviewWorker(fixture.context, fixture.page, 'fixture')).resolves.toBe(true);
    expect(fixture.session.send.mock.calls).toEqual([
      ['ServiceWorker.enable'], ['ServiceWorker.stopWorker', { versionId: 'version-1' }],
    ]);
    expect(fixture.page.evaluate).toHaveBeenCalledOnce();
    expect(fixture.session.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(0);
    expect(fixture.session.detach).toHaveBeenCalledOnce();
  });

  it.each([
    ['initial worker event missing', { omitInitial: true }],
    ['successful stop response without stopped event', { stopStates: ['running'] }],
    ['stopped worker without resumed event', { wakeStates: [] }],
    ['foreign worker events', { version: { scriptURL: 'chrome-extension://foreign/background.js' } }],
    ['different version stopped', { stopVersion: { versionId: 'version-2' } }],
    ['running only before the stop', { stopStates: ['running', 'stopped'], wakeStates: [] }],
    ['suspended stop command', { hangMethod: 'ServiceWorker.stopWorker' }],
  ])('times out instead of certifying %s and cleans up the CDP session', async (_label, overrides) => {
    vi.useFakeTimers();
    try {
      const fixture = restartFixture(overrides);
      const result = expect(restartInstalledReviewWorker(fixture.context, fixture.page, 'fixture', Date.now() + 100)).rejects.toThrow('service-worker-restart-timeout');
      await vi.advanceTimersByTimeAsync(101);
      await result;
      expect(fixture.session.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(0);
      expect(fixture.session.detach).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each(['ServiceWorker.enable', 'ServiceWorker.stopWorker'])('preserves the %s protocol error and releases the listener', async (failMethod) => {
    const fixture = restartFixture({ failMethod });
    await expect(restartInstalledReviewWorker(fixture.context, fixture.page, 'fixture')).rejects.toThrow('protocol-failed');
    expect(fixture.session.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(0);
    expect(fixture.session.detach).toHaveBeenCalledOnce();
  });

  it('rejects a failed wake instead of treating the observed stop as a restart', async () => {
    const fixture = restartFixture({ wakeError: true });
    await expect(restartInstalledReviewWorker(fixture.context, fixture.page, 'fixture')).rejects.toThrow('wake-failed');
    expect(fixture.session.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(0);
    expect(fixture.session.detach).toHaveBeenCalledOnce();
  });

  it('refuses a failed health response even when restart events exist', async () => {
    const fixture = restartFixture({ healthOk: false });
    await expect(restartInstalledReviewWorker(fixture.context, fixture.page, 'fixture')).rejects.toThrow('must answer its health check');
    expect(fixture.session.listenerCount('ServiceWorker.workerVersionUpdated')).toBe(0);
    expect(fixture.session.detach).toHaveBeenCalledOnce();
  });

  it('does not attach when the deadline has expired', async () => {
    const fixture = restartFixture();
    await expect(restartInstalledReviewWorker(fixture.context, fixture.page, 'fixture', Date.now() - 1)).rejects.toThrow('positive deadline');
    expect(fixture.context.newCDPSession).not.toHaveBeenCalled();
  });
});

describe('installed review network guard', () => {
  it('requires the packaged HTTPS-only connection policy before loading', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tobirink-extension-surface-'));
    const policy = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src https://tobirink.com;";
    await writeManifest(root, policy);
    await expect(assertInstalledReviewExtensionSurface(root)).resolves.toBeUndefined();

    await writeManifest(root, policy.replace('https://tobirink.com', 'wss://tobirink.com'));
    await expect(assertInstalledReviewExtensionSurface(root)).rejects.toThrow();

    await writeManifest(root, policy, { optional_host_permissions: ['https://graphql.anilist.co/*'] });
    await expect(assertInstalledReviewExtensionSurface(root)).rejects.toThrow();

    await writeManifest(root, policy, {
      content_scripts: [{ all_frames: true, js: ['content-scripts/web-bridge.js'], matches: ['https://tobirink.com/*'], run_at: 'document_start', world: 'MAIN' }],
      web_accessible_resources: [{ matches: ['<all_urls>'], resources: ['background.js'] }],
    });
    await expect(assertInstalledReviewExtensionSurface(root)).rejects.toThrow();
  });

  it('simulates MISS offline, observes admission and forwards nothing', async () => {
    const { instance } = await guard();
    const lookup = fakeRoute({
      body: { keys: [key()], schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/lookup',
    });
    await instance.handle(lookup);
    expect(lookup.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(lookup.fetch).not.toHaveBeenCalled();

    const request = fakeRoute({
      body: { key: key(), query, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(request);
    expect(request.abort).toHaveBeenCalledOnce();
    expect(request.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({
      attemptedMutations: 1,
      blockedByBudget: 1,
      failure: undefined,
      forwardedRefreshes: 0,
      forwardedRequests: 0,
      providerAttempts: 0,
      receipts: 0,
    });
    expect(() => instance.throwIfFailed()).not.toThrow();
  });

  it('captures canonical submissions privately without forwarding mutations', async () => {
    const { instance, receiptRoot } = await guard({ captureSubmissions: true, online: true, readBudget: 1 });
    const body = { key: key(), query, schemaVersion: 3 };
    const request = fakeRoute({ body, method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/requests' });
    await instance.handle(request);
    expect(request.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ attemptedMutations: 1, blockedByBudget: 1, capturedRequests: 1, forwardedRequests: 0 });
    expect(await readInstalledReviewSubmissions(receiptRoot, 'tobirink-installed-review-Abc123')).toEqual([body]);
    const [name] = (await readdir(receiptRoot)).filter((value) => value.includes('.submission-'));
    expect((await stat(join(receiptRoot, name))).mode & 0o077).toBe(0);
  });

  it('allows only the exact read contracts and local extension scheme', async () => {
    const { instance } = await guard({ online: true, readBudget: 4 });
    const extension = fakeRoute({ url: 'chrome-extension://extension-id/options.html' });
    await instance.handle(extension);
    expect(extension.continue).toHaveBeenCalledOnce();

    const reads = [
      fakeRoute({ url: discoveryUrl() }),
      fakeRoute({ body: { keys: [key()], schemaVersion: 3 }, method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/lookup' }),
      fakeRoute({ status: 304, url: 'https://tobirink.com/v4/release-models?representation=pages&from=2026-09-25&to=2026-10-11&limit=100' }),
      fakeRoute({ url: 'https://tobirink.com/v3/releases?from=2026-09-25&to=2026-10-11&limit=100' }),
    ];
    for (const route of reads) await instance.handle(route);
    expect(reads.every((route) => route.fetch.mock.calls[0][0].maxRedirects === 0 && route.fetch.mock.calls[0][0].maxRetries === 0)).toBe(true);
    expect(instance.snapshot()).toMatchObject({ failure: undefined, forwardedReads: 4, readAttempts: 4 });
  });

  it('fails closed on provider, foreign and unexpected TobiRink routes', async () => {
    for (const url of [
      'https://graphql.anilist.co/',
      'https://api.mangaupdates.com/v1/search',
      'https://api.mangadex.org/manga',
      'https://kitsu.io/api/edge/anime',
      'https://foreign.invalid/data',
      'https://tobirink.com/health',
    ]) {
      const onFailure = vi.fn(async () => undefined);
      const { instance } = await guard({ onFailure, online: true, readBudget: 1 });
      const route = fakeRoute({ url });
      await instance.handle(route);
      expect(route.abort).toHaveBeenCalledOnce();
      expect(route.fetch).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledOnce();
      expect(() => instance.throwIfFailed()).toThrow(/failed closed/);
    }
  });

  it.each(['application/json', 'application/json; profile=tobirink-season-review-v1'])('accepts only declared discovery capabilities on GET and lookup: %s', async (accept) => {
    const { instance } = await guard({ online: true, readBudget: 2 });
    const read = fakeRoute({ headers: { accept, 'user-agent': 'Chromium/153 installed-review' }, url: discoveryUrl() });
    const lookup = fakeRoute({
      body: { keys: [key()], schemaVersion: 3 }, method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/lookup',
      headers: { accept, 'content-type': 'application/json', origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'user-agent': 'Chromium/153 installed-review' },
    });
    await instance.handle(read);
    await instance.handle(lookup);
    expect(read.fetch).toHaveBeenCalledOnce();
    expect(lookup.fetch).toHaveBeenCalledOnce();
    expect(instance.snapshot()).toMatchObject({ forwardedReads: 2, forwardedRequests: 0 });
  });

  it.each(['application/json; profile=unknown', 'application/json; profile=tobirink-season-review-v1; extra=1'])('rejects unrecognized discovery Accept values: %s', async (accept) => {
    const { instance } = await guard({ online: true, readBudget: 1 });
    const read = fakeRoute({ headers: { accept, 'user-agent': 'Chromium/153 installed-review' }, url: discoveryUrl() });
    await instance.handle(read);
    expect(read.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot().failure).toBe('discovery-read-rejected');
  });

  it('rejects undeclared payload fields, POST queries and private headers', async () => {
    const extraFieldGuard = await guard({ mutationBudget: 1, online: true, readBudget: 1 });
    const extraField = fakeRoute({
      body: { key: key(), query: { ...query, privateUrl: 'https://private.invalid/item' }, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await extraFieldGuard.instance.handle(extraField);
    expect(extraField.fetch).not.toHaveBeenCalled();
    expect(extraFieldGuard.instance.snapshot().failure).toBe('mutation-payload-rejected');

    const queryGuard = await guard({ mutationBudget: 1, online: true, readBudget: 1 });
    const postQuery = fakeRoute({
      body: { key: key(), query, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests?retry=1',
    });
    await queryGuard.instance.handle(postQuery);
    expect(postQuery.fetch).not.toHaveBeenCalled();
    expect(queryGuard.instance.snapshot().failure).toBe('mutation-payload-rejected');

    const headerGuard = await guard({ online: true, readBudget: 1 });
    const privateHeader = fakeRoute({ headers: { accept: 'application/json', cookie: 'private=1', 'user-agent': 'Chromium/153 installed-review' }, url: discoveryUrl() });
    await headerGuard.instance.handle(privateHeader);
    expect(privateHeader.fetch).not.toHaveBeenCalled();
    expect(headerGuard.instance.snapshot().failure).toBe('discovery-read-rejected');

    const undeclaredHeaderGuard = await guard({ mutationBudget: 1, online: true, readBudget: 1 });
    const undeclaredHeader = fakeRoute({
      body: { key: key(), query, schemaVersion: 3 },
      headers: {
        accept: 'application/json',
        'content-language': 'private-marker',
        'content-type': 'application/json',
        origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'user-agent': 'Chromium/153 installed-review',
      },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await undeclaredHeaderGuard.instance.handle(undeclaredHeader);
    expect(undeclaredHeader.fetch).not.toHaveBeenCalled();
    expect(undeclaredHeaderGuard.instance.snapshot().failure).toBe('mutation-payload-rejected');
  });

  it('writes a private receipt before fetch and shares the mutation budget', async () => {
    const receiptRoot = await mkdtemp(join(tmpdir(), 'tobirink-network-receipt-'));
    const { instance } = await guard({ mutationBudget: 2, online: true, readBudget: 1, receiptRoot, refreshBudget: 1 });
    const first = fakeRoute({
      body: { key: key(1), query, schemaVersion: 3 },
      method: 'POST',
      onFetch: async (options) => {
        expect(options).toMatchObject({ maxRedirects: 0, maxRetries: 0 });
        const names = await readdir(receiptRoot);
        expect(names).toEqual(['tobirink-installed-review-Abc123.network-001.json']);
        const path = join(receiptRoot, names[0]);
        expect((await stat(path)).mode & 0o077).toBe(0);
        expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ kind: 'request', sequence: 1 });
      },
      status: 202,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(first);
    expect(first.fulfill).toHaveBeenCalledOnce();

    const second = fakeRoute({
      body: { key: key(2), schemaVersion: 3 },
      method: 'POST',
      status: 202,
      url: 'https://tobirink.com/v3/catalogue/discoveries/refreshes',
    });
    await instance.handle(second);
    expect(second.fulfill).toHaveBeenCalledOnce();

    const third = fakeRoute({
      body: { key: key(3), query, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(third);
    expect(third.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ failure: 'mutation-budget-exceeded', forwardedRefreshes: 1, forwardedRequests: 1, receipts: 2 });
  });

  it('reloads receipts and rejects a duplicate key across request and refresh', async () => {
    const receiptRoot = await mkdtemp(join(tmpdir(), 'tobirink-network-resume-'));
    const firstGuard = await guard({ mutationBudget: 2, online: true, readBudget: 1, receiptRoot, refreshBudget: 1 });
    const first = fakeRoute({
      body: { key: key(4), query, schemaVersion: 3 },
      method: 'POST',
      status: 202,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await firstGuard.instance.handle(first);

    const resumed = await guard({ mutationBudget: 2, online: true, readBudget: 1, receiptRoot, refreshBudget: 1 });
    const duplicate = fakeRoute({
      body: { key: { siteRulesVersion: 'rules-v1', parserVersion: 'parser-v1', mediaKind: 'MANGA', fingerprint: key(4).fingerprint }, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/refreshes',
    });
    await resumed.instance.handle(duplicate);
    expect(duplicate.fetch).not.toHaveBeenCalled();
    expect(resumed.instance.snapshot()).toMatchObject({ failure: 'duplicate-mutation-key', receipts: 1 });
  });

  it('persists the read budget across guard recreation', async () => {
    const receiptRoot = await mkdtemp(join(tmpdir(), 'tobirink-read-resume-'));
    const firstGuard = await guard({ online: true, readBudget: 1, receiptRoot });
    const first = fakeRoute({ url: discoveryUrl(key(7)) });
    await firstGuard.instance.handle(first);
    expect(first.fetch).toHaveBeenCalledOnce();

    const resumed = await guard({ online: true, readBudget: 1, receiptRoot });
    const second = fakeRoute({ url: discoveryUrl(key(8)) });
    await resumed.instance.handle(second);
    expect(second.fetch).not.toHaveBeenCalled();
    expect(resumed.instance.snapshot()).toMatchObject({ failure: 'read-budget-exceeded', readSlots: 1 });
  });

  it('drains accepted reads while preventing new reads before a browser restart', async () => {
    const { instance } = await guard({ online: true, readBudget: 2 });
    const active = fakeRoute({ url: discoveryUrl(key(7)) });
    const simulatedResponse = active.fetch.getMockImplementation();
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    active.fetch.mockImplementation(async () => { await pending; return simulatedResponse(); });
    const handling = instance.handle(active);
    await vi.waitFor(() => expect(active.fetch).toHaveBeenCalledOnce());
    let drained = false;
    const draining = drainInstalledReviewReads(instance).then(alreadyClosed => {
      drained = true;
      expect(alreadyClosed).toBe(false);
    });
    const late = fakeRoute({ url: discoveryUrl(key(8)) });
    await instance.handle(late);
    expect(late.fetch).not.toHaveBeenCalled();
    expect(late.abort).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await handling;
    await draining;
    expect(instance.snapshot()).toMatchObject({ failure: undefined, forwardedReads: 1, inFlight: 0, readPhaseClosed: true });
    instance.openReadPhase();
    const resumed = fakeRoute({ url: discoveryUrl(key(9)) });
    await instance.handle(resumed);
    expect(resumed.fetch).toHaveBeenCalledOnce();
    expect(instance.snapshot()).toMatchObject({ forwardedReads: 2, readSlots: 2, readPhaseClosed: false });
    const excessive = fakeRoute({ url: discoveryUrl(key(10)) });
    await instance.handle(excessive);
    expect(excessive.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot().failure).toBe('read-budget-exceeded');
    expect(() => instance.openReadPhase()).toThrow();
  });

  it('keeps accepted read failures fatal after closing the read phase', async () => {
    const { instance } = await guard({ online: true, readBudget: 1 });
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const active = fakeRoute({ url: discoveryUrl(), fetchError: true, onFetch: () => pending });
    const handling = instance.handle(active);
    await vi.waitFor(() => expect(active.fetch).toHaveBeenCalledOnce());
    instance.closeReadPhase();
    release();
    await handling;
    await instance.drain();
    expect(instance.snapshot().failure).toBe('read-network-failed');
  });

  it('does not relax mutation guards when the read phase closes', async () => {
    const { instance } = await guard({ online: true, readBudget: 1 });
    instance.closeReadPhase();
    const mutation = fakeRoute({ body: { key: key(), query, schemaVersion: 3 }, method: 'POST', url: 'https://tobirink.com/v3/catalogue/discoveries/requests' });
    await instance.handle(mutation);
    expect(mutation.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ blockedByBudget: 1, forwardedRequests: 0 });
  });

  it('installs HTTP and WebSocket routes and rejects sockets without connecting', async () => {
    const { instance } = await guard({ online: true, readBudget: 1 });
    let socketHandler;
    const context = {
      route: vi.fn(async () => undefined),
      routeWebSocket: vi.fn(async (_pattern, handler) => { socketHandler = handler; }),
    };
    await installInstalledReviewNetworkRoutes(context, instance);
    expect(context.route).toHaveBeenCalledWith('**/*', instance.handle);
    expect(context.routeWebSocket).toHaveBeenCalledWith('**/*', instance.handleWebSocket);

    const socket = {
      close: vi.fn(async () => undefined),
      connectToServer: vi.fn(),
      url: () => 'wss://graphql.anilist.co/socket',
    };
    await socketHandler(socket);
    expect(socket.close).toHaveBeenCalledWith({ code: 1008, reason: 'Network policy' });
    expect(socket.connectToServer).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ failure: 'provider-websocket-rejected', providerAttempts: 1, webSocketAttempts: 1 });
  });

  it('seals a WebSocket violation before awaiting its suspended close', async () => {
    let releaseClose;
    let closeStarted;
    const started = new Promise((done) => { closeStarted = done; });
    const released = new Promise((done) => { releaseClose = done; });
    const { instance } = await guard({ mutationBudget: 1, online: true, readBudget: 1 });
    const socket = {
      close: vi.fn(async () => {
        closeStarted();
        await released;
      }),
      url: () => 'wss://graphql.anilist.co/socket',
    };
    const socketHandling = instance.handleWebSocket(socket);
    await started;
    expect(instance.snapshot()).toMatchObject({ failure: 'provider-websocket-rejected', inFlight: 1 });

    const following = fakeRoute({
      body: { key: key(16), query, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(following);
    expect(following.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ forwardedRequests: 0, receipts: 0 });

    releaseClose();
    await socketHandling;
    await instance.drain();
    expect(instance.snapshot().inFlight).toBe(0);
  });

  it.each([200, 400, 409, 429, 503])('rejects mutation status %s after consuming its receipt', async (status) => {
    const { instance } = await guard({ mutationBudget: 1, online: true, readBudget: 1 });
    const route = fakeRoute({
      body: { key: key(status), query, schemaVersion: 3 },
      method: 'POST',
      status,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(route);
    expect(route.abort).toHaveBeenCalledOnce();
    expect(instance.snapshot()).toMatchObject({ failure: 'mutation-status-rejected', forwardedRequests: 1, receipts: 1 });
  });

  it('persists a private failure seal and refuses resumed traffic', async () => {
    const receiptRoot = await mkdtemp(join(tmpdir(), 'tobirink-network-failure-'));
    const first = await guard({ mutationBudget: 1, online: true, readBudget: 1, receiptRoot });
    const rejected = fakeRoute({
      body: { key: key(9), query, schemaVersion: 3 },
      method: 'POST',
      status: 429,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await first.instance.handle(rejected);
    const failurePath = join(receiptRoot, 'tobirink-installed-review-Abc123.network-failure.json');
    expect((await stat(failurePath)).mode & 0o077).toBe(0);
    expect(JSON.parse(await readFile(failurePath, 'utf8'))).toEqual({ code: 'mutation-status-rejected', schemaVersion: 1 });

    const resumed = await guard({ mutationBudget: 1, online: true, readBudget: 1, receiptRoot });
    expect(resumed.instance.snapshot().failure).toBe('mutation-status-rejected');
    expect(() => resumed.instance.throwIfFailed()).toThrow(/failed closed/);
    const following = fakeRoute({ url: discoveryUrl(key(10)) });
    await resumed.instance.handle(following);
    expect(following.fetch).not.toHaveBeenCalled();
  });

  it('drains a late response before exposing final network evidence', async () => {
    let releaseFetch;
    let fetchStarted;
    const started = new Promise((done) => { fetchStarted = done; });
    const released = new Promise((done) => { releaseFetch = done; });
    const { instance } = await guard({ mutationBudget: 1, online: true, readBudget: 1 });
    const route = fakeRoute({
      body: { key: key(11), query, schemaVersion: 3 },
      method: 'POST',
      onFetch: async () => {
        fetchStarted();
        await released;
      },
      status: 429,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    void instance.handle(route);
    await started;
    expect(instance.snapshot()).toMatchObject({ failure: undefined, inFlight: 1 });
    releaseFetch();
    await instance.drain();
    expect(instance.snapshot()).toMatchObject({ failure: 'mutation-status-rejected', inFlight: 0 });
    expect(() => instance.throwIfFailed()).toThrow(/failed closed/);
  });

  it('does not reserve or fetch a request released after another request seals failure', async () => {
    let releaseHeaders;
    let headersStarted;
    const started = new Promise((done) => { headersStarted = done; });
    const released = new Promise((done) => { releaseHeaders = done; });
    const { instance } = await guard({ mutationBudget: 2, online: true, readBudget: 1 });
    const delayed = fakeRoute({
      body: { key: key(13), query, schemaVersion: 3 },
      method: 'POST',
      onHeaders: async () => {
        headersStarted();
        await released;
      },
      status: 202,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    const delayedHandling = instance.handle(delayed);
    await started;

    const rejected = fakeRoute({
      body: { key: key(12), query, schemaVersion: 3 },
      method: 'POST',
      status: 429,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(rejected);
    releaseHeaders();
    await delayedHandling;
    await instance.drain();

    expect(delayed.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ failure: 'mutation-status-rejected', forwardedRequests: 1, receipts: 1 });
  });

  it('seals failure before awaiting a suspended abort', async () => {
    let releaseAbort;
    let abortStarted;
    const started = new Promise((done) => { abortStarted = done; });
    const released = new Promise((done) => { releaseAbort = done; });
    const { instance } = await guard({ mutationBudget: 2, online: true, readBudget: 1 });
    const rejected = fakeRoute({
      body: { key: key(14), query, schemaVersion: 3 },
      method: 'POST',
      onAbort: async () => {
        abortStarted();
        await released;
      },
      status: 429,
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    const rejectedHandling = instance.handle(rejected);
    await started;
    expect(instance.snapshot()).toMatchObject({ failure: 'mutation-status-rejected', forwardedRequests: 1, receipts: 1 });

    const following = fakeRoute({
      body: { key: key(15), query, schemaVersion: 3 },
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(following);
    expect(following.fetch).not.toHaveBeenCalled();
    expect(instance.snapshot()).toMatchObject({ forwardedRequests: 1, receipts: 1 });

    releaseAbort();
    await rejectedHandling;
    await instance.drain();
  });

  it('keeps a failed fetch consumed and blocks all following traffic', async () => {
    const { instance } = await guard({ mutationBudget: 2, online: true, readBudget: 1 });
    const failed = fakeRoute({
      body: { key: key(5), query, schemaVersion: 3 },
      fetchError: true,
      method: 'POST',
      url: 'https://tobirink.com/v3/catalogue/discoveries/requests',
    });
    await instance.handle(failed);
    expect(instance.snapshot()).toMatchObject({ failure: 'mutation-network-failed', forwardedRequests: 1, receipts: 1 });
    const following = fakeRoute({ url: discoveryUrl(key(6)) });
    await instance.handle(following);
    expect(following.abort).toHaveBeenCalledOnce();
    expect(following.fetch).not.toHaveBeenCalled();
  });
});
