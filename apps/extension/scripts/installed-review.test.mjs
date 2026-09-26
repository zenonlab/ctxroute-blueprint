import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createInstalledReviewNetworkGuard, installInstalledReviewNetworkRoutes, readInstalledReviewSubmissions } from './installed-review-network.mjs';
import { assertInstalledReviewExtensionSurface } from './installed-review-surface.mjs';

const key = (index = 1) => ({
  fingerprint: index.toString(16).padStart(64, '0'),
  mediaKind: 'MANGA',
  parserVersion: 'parser-v1',
  siteRulesVersion: 'rules-v1',
});
const query = { discoveryTitles: ['Bounded title'], mediaKind: 'MANGA', sourceTitles: [] };

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
