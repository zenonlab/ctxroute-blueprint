import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const publicOrigin = 'https://tobirink.com';
const providerOrigins = new Set([
  'https://api.mangadex.org',
  'https://api.mangaupdates.com',
  'https://graphql.anilist.co',
  'https://kitsu.io',
]);
const providerHosts = new Set([...providerOrigins].map((origin) => new URL(origin).host));
const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const titleSchema = z.string().trim().min(1).max(200);
const providerSchema = z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']);
const keySchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
  parserVersion: identifierSchema,
  siteRulesVersion: identifierSchema,
});
const lookupSchema = z.strictObject({
  keys: z.array(keySchema).min(1).max(50),
  schemaVersion: z.literal(3),
}).refine(({ keys }) => new Set(keys.map((key) => JSON.stringify(key))).size === keys.length);
const requestSchema = z.strictObject({
  key: keySchema,
  query: z.strictObject({
    discoveryTitles: z.array(titleSchema).min(1).max(4),
    explicitProviderReference: z.strictObject({ externalId: identifierSchema, provider: providerSchema }).optional(),
    mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
    preSerialization: z.boolean().optional(),
    season: z.number().int().positive().max(1000).optional(),
    sourceFormat: z.string().trim().min(1).max(64).optional(),
    sourceTitles: z.array(titleSchema).max(4),
  }),
  schemaVersion: z.literal(3),
});
const refreshSchema = z.strictObject({ key: keySchema, schemaVersion: z.literal(3) });
const receiptSchema = z.strictObject({
  keyDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  kind: z.enum(['request', 'refresh']),
  schemaVersion: z.literal(1),
  sequence: z.number().int().positive().max(2),
});
const readSlotSchema = z.strictObject({ schemaVersion: z.literal(1), sequence: z.number().int().positive().max(5000) });
const failureCodeSchema = z.enum([
  'agenda-read-rejected', 'discovery-read-rejected', 'duplicate-mutation-key',
  'failure-seal-failed', 'foreign-origin-rejected', 'handler-failed',
  'invalid-network-url', 'mutation-budget-exceeded', 'mutation-network-failed',
  'mutation-payload-rejected', 'mutation-receipt-failed', 'mutation-status-rejected',
  'provider-origin-rejected', 'provider-websocket-rejected', 'read-budget-exceeded',
  'read-network-failed', 'read-receipt-failed', 'read-status-rejected',
  'refresh-budget-exceeded', 'unexpected-tobirink-route', 'websocket-rejected',
]);
const failureSchema = z.strictObject({ code: failureCodeSchema, schemaVersion: z.literal(1) });
const headerSchema = z.record(z.string(), z.string());
const discoveryQuerySchema = keySchema;
const releaseQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(256).optional(),
  from: z.iso.date(),
  limit: z.literal('100'),
  to: z.iso.date(),
});
const releaseModelQuerySchema = releaseQuerySchema.extend({ representation: z.literal('pages') });
const okRead = new Set([200]);
const okAgenda = new Set([200, 304]);
const okMutation = new Set([202]);
const jsonAccept = new Set(['application/json']);
const agendaAccept = new Set(['*/*', 'application/json']);
const extensionOriginSchema = z.string().regex(/^chrome-extension:\/\/[a-p]{32}$/u);
const userAgentSchema = z.string().min(1).max(512).regex(/^[\x20-\x7e]+$/u);
const entityTagSchema = z.string().max(160).regex(/^(?:W\/)?"[\x21\x23-\x7e]{1,156}"$/u);

function parseJsonBody(request, schema) {
  const text = z.string().min(1).max(64 * 1024).parse(request.postData());
  return schema.parse(JSON.parse(text));
}

async function validateHeaders(request, accepted, contract = 'read') {
  const headers = headerSchema.parse(await request.allHeaders());
  const required = contract === 'post'
    ? ['accept', 'content-type', 'origin', 'user-agent']
    : ['accept', 'user-agent'];
  const optional = contract === 'agenda' && headers['if-none-match'] !== undefined ? ['if-none-match'] : [];
  assert.deepEqual(Object.keys(headers).sort(), [...required, ...optional].sort(), 'Installed-review request contains undeclared headers.');
  assert.ok(accepted.has(headers.accept), 'Installed-review request must request JSON.');
  userAgentSchema.parse(headers['user-agent']);
  if (contract === 'post') {
    assert.equal(headers['content-type'], 'application/json', 'Installed-review POST must send JSON.');
    extensionOriginSchema.parse(headers.origin);
  }
  if (headers['if-none-match'] !== undefined) entityTagSchema.parse(headers['if-none-match']);
  return headers;
}

async function parsePost(request, url, schema) {
  assert.equal(url.search, '', 'Installed-review POST routes forbid query parameters.');
  await validateHeaders(request, jsonAccept, 'post');
  return parseJsonBody(request, schema);
}

function parseQuery(url, schema) {
  const values = Object.fromEntries(url.searchParams);
  assert.equal(url.searchParams.size, Object.keys(values).length, 'Duplicate installed-review query parameter.');
  return schema.parse(values);
}

function digestKey(key) {
  return createHash('sha256').update(JSON.stringify(keySchema.parse(key))).digest('hex');
}

async function readReceipts(root, token) {
  let names;
  try { names = await readdir(root); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const prefix = token + '.network-';
  const selected = names.filter((name) => name.startsWith(prefix) && /^.*\.network-\d{3}\.json$/u.test(name)).sort();
  const receipts = [];
  for (const [index, name] of selected.entries()) {
    const path = join(root, name);
    const [details, raw] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    assert.equal(details.mode & 0o077, 0, 'Installed-review mutation receipt must remain private.');
    const receipt = receiptSchema.parse(JSON.parse(raw));
    assert.equal(receipt.sequence, index + 1, 'Invalid installed-review mutation receipt sequence.');
    receipts.push(receipt);
  }
  assert.equal(new Set(receipts.map(({ keyDigest }) => keyDigest)).size, receipts.length, 'Duplicate installed-review mutation receipt.');
  return receipts;
}

async function readSlots(root, token) {
  let names;
  try { names = await readdir(root); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const prefix = token + '.read-';
  const selected = names.filter((name) => name.startsWith(prefix) && /^.*\.read-\d{4}\.json$/u.test(name)).sort();
  const slots = [];
  for (const [index, name] of selected.entries()) {
    const path = join(root, name);
    const [details, raw] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    assert.equal(details.mode & 0o077, 0, 'Installed-review read slot must remain private.');
    const slot = readSlotSchema.parse(JSON.parse(raw));
    assert.equal(slot.sequence, index + 1, 'Invalid installed-review read slot sequence.');
    slots.push(slot);
  }
  return slots;
}

async function readFailure(root, token) {
  const path = join(root, token + '.network-failure.json');
  try {
    const [details, raw] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    assert.equal(details.mode & 0o077, 0, 'Installed-review network failure must remain private.');
    return failureSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

class InstalledReviewNetworkGuard {
  constructor(options, receipts, readSlots, sealedFailure) {
    this.options = options;
    this.previousReceipts = receipts;
    this.previousReadSlots = readSlots;
    this.seen = new Set(receipts.map(({ keyDigest }) => keyDigest));
    this.failure = sealedFailure?.code;
    this.inFlight = new Set();
    this.reservation = Promise.resolve();
    this.counts = {
      attemptedMutations: 0,
      blockedByBudget: 0,
      foreignAttempts: 0,
      forwardedReads: 0,
      forwardedRefreshes: 0,
      forwardedRequests: 0,
      offlineReads: 0,
      providerAttempts: 0,
      readAttempts: 0,
      readSlots: readSlots.length,
      receipts: receipts.length,
      unexpectedAttempts: 0,
      webSocketAttempts: 0,
    };
    this.handle = this.handle.bind(this);
    this.handleWebSocket = this.handleWebSocket.bind(this);
  }

  async exclusively(operation) {
    const previous = this.reservation;
    let release;
    this.reservation = new Promise((done) => { release = done; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  snapshot() {
    return {
      ...this.counts,
      failure: this.failure,
      inFlight: this.inFlight.size,
      mutationBudget: this.options.mutationBudget,
      readBudget: this.options.readBudget,
      refreshBudget: this.options.refreshBudget,
    };
  }

  throwIfFailed() {
    assert.equal(this.failure, undefined, 'Installed-review network guard failed closed.');
  }

  track(operation) {
    const tracked = (async () => {
      try { return await operation(); }
      catch (error) {
        await this.fail('handler-failed');
        throw error;
      }
    })();
    this.inFlight.add(tracked);
    const remove = () => { this.inFlight.delete(tracked); };
    void tracked.then(remove, remove);
    return tracked;
  }

  async drain() {
    while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight);
  }

  async abort(route, code, fatal = true) {
    const sealing = fatal ? this.fail(code) : undefined;
    await route.abort('blockedbyclient').catch(() => undefined);
    await sealing;
  }

  async fail(code) {
    this.counts.unexpectedAttempts += 1;
    if (this.failure === undefined) {
      this.failure = code;
      const path = join(this.options.receiptRoot, this.options.token + '.network-failure.json');
      try { await writeFile(path, JSON.stringify({ code, schemaVersion: 1 }) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error?.code !== 'EEXIST') this.failure = 'failure-seal-failed'; }
      await this.options.onFailure().catch(() => undefined);
    }
  }

  async acceptResponse(route, response, allowed, code) {
    if (allowed.has(response.status())) {
      await route.fulfill({ response });
      return;
    }
    await this.abort(route, code);
  }

  async forwardRead(route, allowed) {
    this.counts.readAttempts += 1;
    const reservation = await this.exclusively(async () => {
      if (this.failure !== undefined) return 'guard-failed';
      const sequence = this.previousReadSlots.length + this.counts.forwardedReads + 1;
      if (sequence > this.options.readBudget) return 'read-budget-exceeded';
      const path = join(this.options.receiptRoot, `${this.options.token}.read-${String(sequence).padStart(4, '0')}.json`);
      try { await writeFile(path, JSON.stringify({ schemaVersion: 1, sequence }) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch { return 'read-receipt-failed'; }
      this.counts.forwardedReads += 1;
      this.counts.readSlots += 1;
      return 'reserved';
    });
    if (reservation !== 'reserved') {
      await this.abort(route, reservation, reservation !== 'guard-failed');
      return;
    }
    if (this.failure !== undefined) {
      await this.abort(route, 'guard-failed', false);
      return;
    }
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15_000 });
      await this.acceptResponse(route, response, allowed, 'read-status-rejected');
    } catch { await this.abort(route, 'read-network-failed'); }
  }

  async handleMutation(route, request, kind) {
    this.counts.attemptedMutations += 1;
    let submission;
    try { submission = await parsePost(request, new URL(request.url()), kind === 'request' ? requestSchema : refreshSchema); }
    catch { await this.abort(route, 'mutation-payload-rejected'); return; }
    if (this.options.mutationBudget === 0) {
      this.counts.blockedByBudget += 1;
      await this.abort(route, 'mutation-budget-zero', false);
      return;
    }
    const digest = digestKey(submission.key);
    const reservation = await this.exclusively(async () => {
      if (this.failure !== undefined) return 'guard-failed';
      const currentMutations = this.counts.forwardedRequests + this.counts.forwardedRefreshes;
      if (this.previousReceipts.length + currentMutations >= this.options.mutationBudget) return 'mutation-budget-exceeded';
      const previousRefreshes = this.previousReceipts.filter((receipt) => receipt.kind === 'refresh').length;
      if (kind === 'refresh' && previousRefreshes + this.counts.forwardedRefreshes >= this.options.refreshBudget) return 'refresh-budget-exceeded';
      if (this.seen.has(digest)) return 'duplicate-mutation-key';
      const sequence = this.previousReceipts.length + currentMutations + 1;
      const receipt = { keyDigest: digest, kind, schemaVersion: 1, sequence };
      const path = join(this.options.receiptRoot, `${this.options.token}.network-${String(sequence).padStart(3, '0')}.json`);
      try { await writeFile(path, JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch { return 'mutation-receipt-failed'; }
      this.seen.add(digest);
      this.counts.receipts += 1;
      if (kind === 'request') this.counts.forwardedRequests += 1;
      else this.counts.forwardedRefreshes += 1;
      return 'reserved';
    });
    if (reservation !== 'reserved') {
      await this.abort(route, reservation, reservation !== 'guard-failed');
      return;
    }
    if (this.failure !== undefined) {
      await this.abort(route, 'guard-failed', false);
      return;
    }
    try {
      const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15_000 });
      await this.acceptResponse(route, response, okMutation, 'mutation-status-rejected');
    } catch { await this.abort(route, 'mutation-network-failed'); }
  }

  async handleDiscoveryRead(route, request, url) {
    try {
      let keys;
      if (request.method() === 'GET') {
        await validateHeaders(request, jsonAccept);
        keys = [parseQuery(url, discoveryQuerySchema)];
      } else keys = (await parsePost(request, url, lookupSchema)).keys;
      this.counts.readAttempts += 1;
      if (!this.options.online) {
        this.counts.offlineReads += 1;
        const body = request.method() === 'GET'
          ? { state: 'MISS' }
          : keys.map((key) => ({ key, state: { state: 'MISS' } }));
        await route.fulfill({ body: JSON.stringify(body), contentType: 'application/json', status: 200 });
        return;
      }
      this.counts.readAttempts -= 1;
      await this.forwardRead(route, okRead);
    } catch { await this.abort(route, 'discovery-read-rejected'); }
  }

  async handleAgendaRead(route, url) {
    const request = route.request();
    try {
      await validateHeaders(request, agendaAccept, 'agenda');
      parseQuery(url, url.pathname === '/v4/release-models' ? releaseModelQuerySchema : releaseQuerySchema);
    }
    catch { await this.abort(route, 'agenda-read-rejected'); return; }
    this.counts.readAttempts += 1;
    if (!this.options.online) {
      this.counts.offlineReads += 1;
      await this.abort(route, 'offline-agenda-read', false);
      return;
    }
    this.counts.readAttempts -= 1;
    await this.forwardRead(route, okAgenda);
  }

  handle(route) {
    return this.track(() => this.dispatch(route));
  }

  async dispatch(route) {
    const request = route.request();
    let url;
    try { url = new URL(request.url()); }
    catch { await this.abort(route, 'invalid-network-url'); return; }
    if (url.protocol === 'chrome-extension:') {
      await route.continue();
      return;
    }
    if (this.failure !== undefined) {
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    if (url.origin !== publicOrigin) {
      this.counts.foreignAttempts += 1;
      const providerAttempt = providerOrigins.has(url.origin);
      if (providerAttempt) this.counts.providerAttempts += 1;
      await this.abort(route, providerAttempt ? 'provider-origin-rejected' : 'foreign-origin-rejected');
      return;
    }
    const method = request.method();
    if (method === 'GET' && url.pathname === '/v3/catalogue/discoveries'
      || method === 'POST' && url.pathname === '/v3/catalogue/discoveries/lookup') {
      await this.handleDiscoveryRead(route, request, url);
      return;
    }
    if (method === 'GET' && (url.pathname === '/v4/release-models' || url.pathname === '/v3/releases')) {
      await this.handleAgendaRead(route, url);
      return;
    }
    if (method === 'POST' && url.pathname === '/v3/catalogue/discoveries/requests') {
      await this.handleMutation(route, request, 'request');
      return;
    }
    if (method === 'POST' && url.pathname === '/v3/catalogue/discoveries/refreshes') {
      await this.handleMutation(route, request, 'refresh');
      return;
    }
    await this.abort(route, 'unexpected-tobirink-route');
  }

  handleWebSocket(webSocket) {
    return this.track(() => this.dispatchWebSocket(webSocket));
  }

  async dispatchWebSocket(webSocket) {
    this.counts.webSocketAttempts += 1;
    let providerAttempt = false;
    try { providerAttempt = providerHosts.has(new URL(webSocket.url()).host); }
    catch { providerAttempt = false; }
    this.counts.foreignAttempts += 1;
    if (providerAttempt) this.counts.providerAttempts += 1;
    const sealing = this.fail(providerAttempt ? 'provider-websocket-rejected' : 'websocket-rejected');
    await webSocket.close({ code: 1008, reason: 'Network policy' }).catch(() => undefined);
    await sealing;
  }
}

export async function createInstalledReviewNetworkGuard(options) {
  const [receipts, slots, sealedFailure] = await Promise.all([
    readReceipts(options.receiptRoot, options.token),
    readSlots(options.receiptRoot, options.token),
    readFailure(options.receiptRoot, options.token),
  ]);
  assert.ok(receipts.length <= options.mutationBudget, 'Existing mutation receipts exceed the configured budget.');
  assert.ok(receipts.filter(({ kind }) => kind === 'refresh').length <= options.refreshBudget, 'Existing refresh receipts exceed the configured budget.');
  assert.ok(slots.length <= options.readBudget, 'Existing read slots exceed the configured budget.');
  return new InstalledReviewNetworkGuard(options, receipts, slots, sealedFailure);
}

export async function installInstalledReviewNetworkRoutes(context, guard) {
  await context.route('**/*', guard.handle);
  await context.routeWebSocket('**/*', guard.handleWebSocket);
}
