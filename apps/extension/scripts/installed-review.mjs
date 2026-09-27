import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstalledRecoveryObservation, createInstalledReviewNetworkGuard, installInstalledReviewNetworkRoutes } from './installed-review-network.mjs';
import { assertInstalledReviewExtensionSurface } from './installed-review-surface.mjs';
import { loadSourceScope, validateSourceScope } from '../../../scripts/infra/discovery-recovery-batch.mjs';

export { createInstalledReviewNetworkGuard } from './installed-review-network.mjs';

const descriptorRoot = fileURLToPath(new URL('../../../build/installed-review/', import.meta.url));
const countNames = ['observed', 'processing', 'resolved', 'review', 'retryable', 'blocked', 'unsupported', 'internalErrors', 'publicDiscoveryPending', 'admissionWaiting', 'rateLimited', 'networkErrors', 'actionRequired', 'providerPaused'];
const wait = (milliseconds) => new Promise((done) => { setTimeout(done, milliseconds); });

function integer(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum, 'Invalid bounded installed-review configuration.');
  return parsed;
}

export function installedReviewConfig(env = process.env) {
  const online = env.TOBIRINK_REAL_RUN === '1';
  assert.ok(!online || env.TOBIRINK_FAVORITES_EXPORT, 'Online testing requires an explicit private bookmark export.');
  const budgetSeconds = integer(env.TOBIRINK_INSTALLED_BUDGET_SECONDS, online ? 600 : 240, 30, 1800);
  const bookmarkLimit = integer(env.TOBIRINK_INSTALLED_BOOKMARK_LIMIT, 100_000, 1, 100_000);
  const sourceScopePath = env.TOBIRINK_INSTALLED_SOURCE_SCOPE;
  const recoverExhausted = env.TOBIRINK_INSTALLED_RECOVER_EXHAUSTED === '1';
  assert.ok(env.TOBIRINK_INSTALLED_RECOVER_EXHAUSTED === undefined || recoverExhausted, 'Recovery requires explicit 1.');
  assert.ok(!recoverExhausted || online && sourceScopePath !== undefined, 'Recovery button requires an online sealed source scope.');
  assert.ok(sourceScopePath === undefined || sourceScopePath.trim().length > 0, 'Source scope path must not be empty.');
  const mutationBudget = integer(env.TOBIRINK_INSTALLED_MUTATION_BUDGET, 0, 0, sourceScopePath === undefined ? 2 : 10);
  const captureSubmissions = env.TOBIRINK_INSTALLED_CAPTURE_SUBMISSIONS === '1';
  assert.ok(env.TOBIRINK_INSTALLED_CAPTURE_SUBMISSIONS === undefined || captureSubmissions, 'Submission capture must be explicitly enabled with 1.');
  const refreshBudget = integer(env.TOBIRINK_INSTALLED_REFRESH_BUDGET, 0, 0, 2);
  const readBudget = integer(env.TOBIRINK_INSTALLED_READ_BUDGET, online ? 200 : 0, 0, 5000);
  assert.ok(online || mutationBudget === 0 && refreshBudget === 0 && readBudget === 0, 'Offline installed review cannot forward network requests.');
  assert.ok(refreshBudget <= mutationBudget, 'Refresh budget must fit inside the combined mutation budget.');
  assert.ok(!captureSubmissions || online && mutationBudget === 0 && refreshBudget === 0, 'Submission capture requires an online zero-mutation review.');
  const milestones = env.TOBIRINK_INSTALLED_OBSERVE_SECONDS === undefined
    ? [15, 60, 180, Math.floor(budgetSeconds / 2)]
    : env.TOBIRINK_INSTALLED_OBSERVE_SECONDS.split(',').map((value) => integer(value, 0, 1, budgetSeconds - 1));
  assert.ok(milestones.length <= 12, 'At most twelve observation milestones are allowed.');
  const session = env.TOBIRINK_INSTALLED_SESSION;
  assert.ok(session === undefined || /^tobirink-installed-review-[A-Za-z0-9]{6,32}$/u.test(session), 'Invalid installed-review session token.');
  return { online, budgetSeconds, bookmarkLimit, mutationBudget, captureSubmissions, refreshBudget, readBudget, sourceScopePath, recoverExhausted, favoritesExport: env.TOBIRINK_FAVORITES_EXPORT, session,
    milestones: [...new Set(milestones.filter((value) => value < budgetSeconds - 5))].sort((left, right) => left - right) };
}

export function importedBookmarks(html) {
  const decode = (value) => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#39;', "'");
  return [...html.matchAll(/<A\s+[^>]*HREF="([^"]+)"[^>]*>([\s\S]*?)<\/A>/giu)]
    .map((match) => ({ title: decode(match[2].replace(/<[^>]+>/gu, '').trim()), url: decode(match[1]) }))
    .filter(({ title, url }) => title.length > 0 && /^https?:\/\//iu.test(url));
}

export function installedBookmarkCorpusDigest(bookmarks) {
  return createHash('sha256').update(JSON.stringify(bookmarks.map(({ title, url }) => ({ title, url })))).digest('hex');
}

function syntheticBookmarks() {
  const items = [];
  for (let index = 0; index < 1393; index += 1) items.push({ title: 'Synthetic corpus ' + index, url: 'https://reader.invalid/manga/synthetic-corpus-' + index + '/42' });
  for (let index = 0; index < 132; index += 1) items.push({ title: 'Synthetic utility ' + index, url: 'https://reader.invalid/search/synthetic-' + index });
  return [...items,
    { title: 'Synthetic anime reference', url: 'https://anilist.co/anime/1233' },
    { title: 'Synthetic pending manga', url: 'https://www.mangaupdates.com/series/abc123/synthetic-pending-manga' },
    { title: 'Synthetic pending manhwa 006', url: 'https://manhwaz.com/webtoon/synthetic-pending-manhwa-006/chapter-66.1' },
    { title: 'Synthetic cache anime', url: 'https://reader.example/anime/synthetic-cache-anime' },
    { title: 'Synthetic rescued manga Chapter 31', url: 'https://reader.example/view/9384/chapter/31' },
    { title: '0906168628 Genius of the Unique Lineage', url: 'https://www.asurascans.com/0906168628-genius-of-the-unique-lineage-chapter-31/' },
    { title: 'Artifact Reading Appraiser | Chapter 18 | Void Scans', url: 'https://void-scans.com/1/artifact-reading-appraiser-chapter-18/' },
  ];
}

export function installedConverged(snapshot, expected) {
  return snapshot.inventory === 'complete' && snapshot.counts.observed === expected
    && snapshot.counts.processing === 0 && snapshot.counts.retryable === 0 && snapshot.counts.blocked === 0
    && snapshot.counts.resolved + snapshot.counts.review + snapshot.counts.unsupported === expected
    && snapshot.unresolved === 0 && snapshot.missingProjectedWorks === 0;
}

export function installedVerdict(snapshot, expected, online) {
  if (online) return installedConverged(snapshot, expected) ? 'converged' : 'incomplete';
  return snapshot.inventory === 'complete' && snapshot.counts.observed === expected
    && snapshot.counts.processing === 0 && snapshot.counts.blocked === 0
    && snapshot.counts.resolved + snapshot.counts.review + snapshot.counts.retryable + snapshot.counts.unsupported === expected
    && snapshot.unresolved === 0 && snapshot.missingProjectedWorks === 0 ? 'offline-regression-passed' : 'incomplete';
}

export function installedFailureVerdict(error, expired, deadline, now, networkFailure, closeFailure = false) {
  if (closeFailure || networkFailure !== undefined || error instanceof assert.AssertionError) return 'failed';
  return expired || now >= deadline - 15_000 ? 'incomplete' : 'failed';
}

function extractArchive(archive, destination) {
  const result = spawnSync('unzip', ['-oq', archive, '-d', destination], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, 'Temporary test archive extraction failed.');
}

export function summarizeInstalledDiagnosticFailures(diagnostics) {
  const events = Array.isArray(diagnostics?.events) ? diagnostics.events.slice(-100) : [];
  const knownCodes = new Set(['INTERNAL_FAILURE', 'DISCOVERY_CANDIDATE_SCHEMA_INVALID', 'DISCOVERY_CANDIDATE_DOMAIN_INVALID',
    'SCHEMA_VALIDATION_FAILED', 'DOMAIN_INVARIANT_FAILED', 'TYPE_ERROR', 'STALE_PRIVATE_REFERENCE', 'STALE_WORK_IDENTITY',
    'HYDRATION_REFERENCE_MISMATCH', 'AMBIGUOUS_REVIEW_REQUIRES_COMPARABLE_IDENTITIES']);
  const failures = [];
  for (const event of events) {
    if (event?.outcome !== 'failed') continue;
    const operation = ['admission', 'provider-result', 'resolution-commit', 'projection', 'continuation'].includes(event.operation) ? event.operation : 'other';
    const code = knownCodes.has(event.code) ? event.code : 'OTHER_FAILURE';
    const previous = failures.find(failure => failure.operation === operation && failure.code === code);
    if (previous === undefined) failures.push({ operation, code, count: 1 });
    else previous.count += 1;
  }
  return { windowLimit: 100, sampledEvents: events.length, failures };
}

async function capture(page) {
  const snapshot = await page.evaluate(async (fields) => {
    const status = await globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 });
    if (!status.ok) throw new Error('status-unavailable');
    const library = await globalThis.chrome.runtime.sendMessage({ type: 'library.catalogue.read', version: 1, sort: 'TITLE_ASC' });
    if (!library.ok) throw new Error('catalogue-unavailable');
    const database = await new Promise((done, reject) => {
      const opening = globalThis.indexedDB.open('tobirink-private');
      opening.onsuccess = () => done(opening.result);
      opening.onerror = () => reject(new Error('private-database-unavailable'));
    });
    const names = ['favoriteSources', 'favoriteArtifacts', 'works', 'libraries', 'progress', 'reviews'];
    let records;
    try {
      const transaction = database.transaction(names, 'readonly');
      records = await Promise.all(names.map((name) => new Promise((done, reject) => {
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = () => done(request.result);
        request.onerror = () => reject(new Error('private-read-failed'));
      })));
    } finally { database.close(); }
    const [sources, artifacts, works, libraries, progress, reviews] = records;
    const artifactBySource = new Map(artifacts.map((record) => [record.sourceId, record.artifact]));
    const workIds = new Set(works.map((work) => work.id));
    const libraryIds = new Set(libraries.flatMap((entry) => entry.workIds));
    const reasons = {};
    const media = { ANIME: 0, MANGA: 0, MANHWA: 0, MANHUA: 0, UNKNOWN: 0 };
    const reasonNames = new Set(['RESOLVED', 'AMBIGUOUS', 'NOT_FOUND', 'IDENTITY_MISSING', 'DETACHED', 'BLOCKED_CONTENT_TAXONOMY', 'PROVIDER_UNAVAILABLE', 'INCOMPLETE_CANDIDATE_SET', 'AUTOMATIC_ATTEMPT_LIMIT', 'INTERNAL_FAILURE', 'PUBLIC_DISCOVERY_PENDING', 'ADMISSION_WAIT', 'RATE_LIMITED', 'NETWORK', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'CONTRACT_CONFLICT', 'INVALID_RESPONSE']);
    let unresolved = 0;
    let missingProjectedWorks = 0;
    for (const source of sources) {
      const reason = source.resolution?.reason ?? source.resolution?.kind;
      const safeReason = reasonNames.has(reason) ? reason : 'UNRESOLVED';
      reasons[safeReason] = (reasons[safeReason] ?? 0) + 1;
      if (safeReason === 'UNRESOLVED') unresolved += 1;
      const kind = artifactBySource.get(source.id)?.mediaKind;
      media[Object.hasOwn(media, kind) ? kind : 'UNKNOWN'] += 1;
      if (source.presence === 'observed' && source.resolution?.kind === 'RESOLVED'
        && (!source.matchedWorkId || !workIds.has(source.matchedWorkId) || !libraryIds.has(source.matchedWorkId))) missingProjectedWorks += 1;
    }
    const digest = async (value) => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new globalThis.TextEncoder().encode(JSON.stringify(value)))), (byte) => byte.toString(16).padStart(2, '0')).join('');
    // Integrity values stay in process memory, never in logs or report artifacts.
    const integrity = {
      sources: await Promise.all(sources.map((source) => digest([source.id, source.bookmarkId, source.title, source.url, source.folderPath, source.order, source.importedAt, source.presence]))),
      works: await Promise.all(works.map((work) => digest(work.id))),
      library: await Promise.all([...libraryIds].map(digest)),
      humanReviews: await Promise.all(reviews.filter((review) => review.decisionOrigin === 'human').map((review) => digest([review.id, review.status, review.matchedWorkId, review.reason, review.title, review.sourceLabel, review.availableAt]))),
      progress: await Promise.all(progress.map(async (entry) => ({ identity: await digest([entry.id, entry.workId, entry.kind]), value: entry.value }))),
    };
    const counts = Object.fromEntries(fields.map((field) => [field, Number.isSafeInteger(status.counts[field]) ? status.counts[field] : 0]));
    const statistics = Object.fromEntries(['completed', 'inProgress', 'knownMetadata', 'notStarted', 'total'].map((field) => [field, library.snapshot.statistics[field]]));
    return { aggregate: { counts, inventory: status.inventory.status, reasons, media, unresolved, missingProjectedWorks,
      library: statistics, works: works.length, reviews: reviews.length, humanReviews: integrity.humanReviews.length, progress: progress.length }, integrity, diagnostics: status.diagnostics };
  }, countNames);
  return { aggregate: { ...snapshot.aggregate, diagnosticFailureSample: summarizeInstalledDiagnosticFailures(snapshot.diagnostics) }, integrity: snapshot.integrity };
}

export function assertPreserved(before, after, expected) {
  assert.equal(after.aggregate.counts.observed, expected, 'Source count must survive a restart.');
  for (const field of ['sources', 'works', 'library', 'humanReviews']) {
    const values = new Set(after.integrity[field]);
    assert.ok(before.integrity[field].every((value) => values.has(value)), 'Private state was not retained: ' + field);
  }
  const progress = new Map(after.integrity.progress.map((entry) => [entry.identity, entry.value]));
  assert.ok(before.integrity.progress.every((entry) => progress.has(entry.identity) && progress.get(entry.identity) >= entry.value), 'Private progress regressed.');
}

export async function restartInstalledReviewWorker(context, page, extensionId, deadline = Date.now() + 15_000) {
  const remaining = Math.min(15_000, deadline - Date.now());
  assert.ok(Number.isFinite(remaining) && remaining > 0, 'The service-worker restart requires a positive deadline.');
  let timeout;
  const expired = new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('service-worker-restart-timeout')), remaining); });
  const bounded = (operation) => Promise.race([operation, expired]);
  let resolveReady;
  let resolveStopped;
  let resolveRestarted;
  const ready = new Promise((done) => { resolveReady = done; });
  const stopped = new Promise((done) => { resolveStopped = done; });
  const restarted = new Promise((done) => { resolveRestarted = done; });
  let versionId;
  let interrupting = false;
  let observedStopped = false;
  const onVersions = ({ versions }) => {
    for (const version of versions) {
      if (version.scriptURL !== 'chrome-extension://' + extensionId + '/background.js') continue;
      if (!interrupting) {
        if (version.runningStatus === 'running' && versionId === undefined) {
          versionId = version.versionId;
          resolveReady();
        }
        continue;
      }
      if (version.versionId !== versionId) continue;
      if (version.runningStatus === 'stopped') {
        observedStopped = true;
        resolveStopped();
      }
      if (version.runningStatus === 'running' && observedStopped) resolveRestarted();
    }
  };
  let debugging;
  const attachment = context.newCDPSession(page);
  try {
    debugging = await bounded(attachment);
    debugging.on('ServiceWorker.workerVersionUpdated', onVersions);
    await bounded(debugging.send('ServiceWorker.enable'));
    await bounded(ready);
    interrupting = true;
    await bounded(debugging.send('ServiceWorker.stopWorker', { versionId }));
    await bounded(stopped);
    const health = await bounded(page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'health.check', version: 1 })));
    assert.equal(health.ok, true, 'The restarted service worker must answer its health check.');
    await bounded(restarted);
    return true;
  } finally {
    if (debugging !== undefined) {
      debugging.off('ServiceWorker.workerVersionUpdated', onVersions);
      await bounded(debugging.detach()).catch(() => undefined);
    } else {
      void attachment.then((lateSession) => lateSession.detach()).catch(() => undefined);
    }
    clearTimeout(timeout);
  }
}

export async function runInstalledReview(argv = process.argv.slice(2), env = process.env) {
  const config = installedReviewConfig(env);
  const [archive, previousArchive] = argv;
  assert.ok(previousArchive === undefined || archive !== undefined, 'Upgrade requires a candidate archive.');
  const startedAt = Date.now();
  const deadline = startedAt + config.budgetSeconds * 1000;
  const observations = [];
  const dataOrigin = { source: config.favoritesExport === undefined ? 'synthetic' : 'private-bookmark-export', privateDatabaseCopied: false, personalProfileCertified: false };
  let stage = 'prepare';
  let context;
  let closeFailure = false;
  let closePromise;
  let networkGuard;
  let recoveryObservation;
  let session;
  let expired = false;
  const log = (value) => process.stdout.write(JSON.stringify(value) + '\n');
  const checkpoint = async () => writeFile(join(descriptorRoot, session.token + '.json'), JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  const closeContext = async (required = true) => {
    if (closePromise === undefined && context !== undefined) {
      const closing = context;
      closePromise = closing.close()
        .then(() => { if (context === closing) context = undefined; })
        .finally(() => { closePromise = undefined; });
    }
    if (closePromise === undefined) return;
    try { await closePromise; }
    catch (error) {
      closeFailure = true;
      if (required) throw error;
    }
  };
  const watchdog = setTimeout(() => { expired = true; void closeContext(false); }, config.budgetSeconds * 1000);
  try {
    const corpus = config.favoritesExport === undefined ? syntheticBookmarks() : importedBookmarks(await readFile(config.favoritesExport, 'utf8'));
    assert.ok(corpus.length > 0, 'No importable HTTP favorites.');
    const bookmarks = corpus.slice(0, config.bookmarkLimit);
    const corpusDigest = installedBookmarkCorpusDigest(bookmarks);
    await mkdir(descriptorRoot, { recursive: true, mode: 0o700 });
    const sourceScope = config.sourceScopePath === undefined ? undefined : await loadSourceScope(config.sourceScopePath);
    if (sourceScope !== undefined) {
      assert.equal(config.mutationBudget, sourceScope.entries.length, 'Scoped pilot must explicitly authorize every identity.');
      assert.equal(bookmarks.length, sourceScope.entries.length, 'Scoped pilot requires one bookmark per sealed identity.');
    }
    const network = { captureSubmissions: config.captureSubmissions, mutationBudget: config.mutationBudget, readBudget: config.readBudget, refreshBudget: config.refreshBudget };
    if (sourceScope !== undefined) network.scopeSeal = validateSourceScope(sourceScope).scopeSeal;
    if (config.session !== undefined) {
      session = JSON.parse(await readFile(join(descriptorRoot, config.session + '.json'), 'utf8'));
      assert.equal(session.schemaVersion, 3, 'Sessions created before the exact corpus and network guard cannot be resumed.');
      assert.equal(session.token, config.session);
      assert.equal(session.root, join(tmpdir(), session.token), 'Resume must use the generated temporary profile.');
      assert.equal(session.online, config.online, 'Resume must preserve the configured network mode.');
      assert.deepEqual(session.network, network, 'Resume must preserve the configured network budgets.');
      assert.equal(session.source ?? 'synthetic', dataOrigin.source, 'Resume must preserve the source provenance.');
      assert.equal(session.expected, bookmarks.length, 'Resume must preserve the source count.');
      assert.equal(session.corpusDigest, corpusDigest, 'Resume must preserve the exact private source corpus.');
      assert.equal(previousArchive, undefined, 'A resumed session must not be reseeded or downgraded.');
    } else {
      const root = await mkdtemp(join(tmpdir(), 'tobirink-installed-review-'));
      session = { schemaVersion: 3, token: basename(root), root, corpusDigest, expected: bookmarks.length, network, online: config.online, source: dataOrigin.source, seeded: false };
      await mkdir(join(root, 'extension'), { mode: 0o700 });
      if (archive !== undefined) extractArchive(previousArchive ?? archive, join(root, 'extension'));
      else await cp(fileURLToPath(new URL('../.output/chrome-mv3', import.meta.url)), join(root, 'extension'), { recursive: true });
      await checkpoint();
    }
    await assertInstalledReviewExtensionSurface(join(session.root, 'extension'));
    networkGuard = await createInstalledReviewNetworkGuard({ ...network, sourceScope, online: config.online, receiptRoot: descriptorRoot, token: session.token,
      onAdmission: async (submission, response) => recoveryObservation.onAdmission(submission, response),
      onFailure: async () => { void closeContext(false); } });
    if (sourceScope !== undefined) recoveryObservation = await createInstalledRecoveryObservation({
      onFailure: async () => networkGuard.fail('correlation-failed'),
      recordAdmission: async receipt => {
        const keyDigest = createHash('sha256').update(JSON.stringify(receipt.key)).digest('hex');
        await writeFile(join(descriptorRoot, `${session.token}.correlation-${keyDigest}.json`), JSON.stringify(receipt) + '\n', { flag: 'wx', mode: 0o600 });
      },
    });
    log({ event: 'installed-session', session: session.token, mode: config.online ? 'online-private-copy' : 'offline', dataOrigin, selected: session.expected, available: corpus.length, budgetSeconds: config.budgetSeconds, network: networkGuard.snapshot() });
    const require = createRequire(new URL('../../web/package.json', import.meta.url));
    const { chromium } = require('@playwright/test');
    const launchOptions = { args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'], channel: 'chromium', headless: true };
    if (!config.online) launchOptions.args.push('--host-resolver-rules=MAP * 127.0.0.1, EXCLUDE localhost', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>');
    const launch = async () => {
      context = await chromium.launchPersistentContext(join(session.root, 'profile'), { ...launchOptions, timeout: Math.max(1, Math.min(30_000, deadline - Date.now())) });
      await installInstalledReviewNetworkRoutes(context, networkGuard);
      await context.setOffline(!config.online);
      context.setDefaultTimeout(Math.max(1, Math.min(20_000, deadline - Date.now())));
      return context.browser().newBrowserCDPSession();
    };
    let debugging = await launch();
    let page = await context.newPage();
    if (!session.seeded) {
      stage = 'seed';
      const seeder = join(session.root, 'seeder');
      await mkdir(seeder, { mode: 0o700 });
      await writeFile(join(seeder, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Tobirink isolated bookmark importer', permissions: ['bookmarks'], version: '1.0.0' }), { mode: 0o600 });
      await writeFile(join(seeder, 'seed.html'), '<!doctype html><meta charset="utf-8">', { mode: 0o600 });
      const loaded = await debugging.send('Extensions.loadUnpacked', { path: seeder });
      await page.goto('chrome-extension://' + loaded.id + '/seed.html');
      await page.evaluate(async (items) => {
        const folder = await globalThis.chrome.bookmarks.create({ title: 'Isolated test import' });
        for (const item of items) await globalThis.chrome.bookmarks.create({ parentId: folder.id, title: item.title, url: item.url });
      }, bookmarks);
      session.seeded = true;
      await checkpoint();
    }
    const loadExtension = async () => {
      networkGuard.throwIfFailed();
      const loaded = await debugging.send('Extensions.loadUnpacked', { path: join(session.root, 'extension') });
      if (session.extensionId !== undefined) assert.equal(loaded.id, session.extensionId, 'Extension identity must survive upgrades and restarts.');
      session.extensionId = loaded.id;
      await page.goto('chrome-extension://' + loaded.id + '/options.html');
      const health = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'health.check', version: 1 }));
      assert.equal(health.ok, true);
      networkGuard.throwIfFailed();
      session.version = await page.evaluate(() => globalThis.chrome.runtime.getManifest().version);
      await checkpoint();
    };
    stage = 'install';
    await loadExtension();
    const observe = async (label) => {
      networkGuard.throwIfFailed();
      const snapshot = await capture(page);
      networkGuard.throwIfFailed();
      const entry = { event: 'installed-observation', label, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), version: session.version, ...snapshot.aggregate };
      entry.converged = installedConverged(entry, session.expected);
      observations.push(entry);
      log(entry);
      return snapshot;
    };
    const readStatus = async () => {
      networkGuard.throwIfFailed();
      const status = await page.evaluate(() => globalThis.chrome.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
      networkGuard.throwIfFailed();
      return status;
    };
    const waitForInventory = async () => {
      let lastProgress = 0;
      while (Date.now() < deadline - 15_000) {
        const status = await readStatus();
        if (status.ok && status.inventory.status === 'complete' && status.counts.observed === session.expected) return;
        if (Date.now() - lastProgress >= 30_000) {
          log({ event: 'installed-progress', stage, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), observed: status.counts?.observed ?? 0, expected: session.expected });
          lastProgress = Date.now();
        }
        await wait(Math.min(5000, Math.max(1, deadline - Date.now() - 15_000)));
      }
      throw new Error('inventory-incomplete');
    };
    await waitForInventory();
    let before = await observe('initial-inventory');
    if (config.recoverExhausted) {
      stage = 'explicit-recovery-button';
      await page.getByRole('button', { name: 'Relancer les demandes épuisées', exact: true }).click();
    }
    let upgraded = false;
    if (previousArchive !== undefined || config.session !== undefined && archive !== undefined) {
      stage = 'upgrade';
      const oldVersion = session.version;
      await closeContext();
      extractArchive(archive, join(session.root, 'extension'));
      await assertInstalledReviewExtensionSurface(join(session.root, 'extension'));
      debugging = await launch();
      page = await context.newPage();
      await loadExtension();
      assert.notEqual(session.version, oldVersion, 'Upgrade must exercise a different extension version.');
      await waitForInventory();
      const after = await observe('after-upgrade');
      assertPreserved(before, after, session.expected);
      before = after;
      upgraded = true;
      log({ event: 'installed-upgrade', previousVersion: oldVersion, version: session.version, retained: true });
    }
    stage = 'service-worker-restart';
    const workerRestartObserved = await restartInstalledReviewWorker(context, page, session.extensionId, Math.min(deadline - 15_000, Date.now() + 15_000));
    const afterWorker = await observe('after-service-worker-restart');
    assertPreserved(before, afterWorker, session.expected);
    stage = 'browser-restart';
    await closeContext();
    debugging = await launch();
    page = await context.newPage();
    await loadExtension();
    const afterBrowser = await observe('after-browser-restart');
    assertPreserved(afterWorker, afterBrowser, session.expected);
    stage = 'observe';
    let milestoneIndex = 0;
    let lastProgress = 0;
    while (Date.now() < deadline - 5000) {
      const elapsed = (Date.now() - startedAt) / 1000;
      if (config.milestones[milestoneIndex] !== undefined && elapsed >= config.milestones[milestoneIndex]) {
        const observed = await observe('scheduled-' + config.milestones[milestoneIndex]);
        assertPreserved(afterBrowser, observed, session.expected);
        milestoneIndex += 1;
      }
      const status = await readStatus();
      const completed = status.ok && status.inventory.status === 'complete' && status.counts.processing === 0
        && status.counts.resolved + status.counts.review + status.counts.retryable + status.counts.unsupported === session.expected;
      if (!config.online && completed) break;
      if (config.online && completed && status.counts.retryable === 0 && status.counts.blocked === 0 && milestoneIndex >= Math.min(2, config.milestones.length)) break;
      if (Date.now() - lastProgress >= 30_000) {
        log({ event: 'installed-progress', stage, elapsedSeconds: Math.round(elapsed), counts: Object.fromEntries(countNames.map((field) => [field, status.counts?.[field] ?? 0])) });
        lastProgress = Date.now();
      }
      await wait(Math.min(5000, Math.max(1, deadline - Date.now() - 5000)));
    }
    const final = await observe('final');
    assertPreserved(afterBrowser, final, session.expected);
    await closeContext();
    await networkGuard.drain();
    networkGuard.throwIfFailed();
    const networkEvidence = networkGuard.snapshot();
    if (recoveryObservation !== undefined) networkEvidence.correlatedCosts = await recoveryObservation.finish(sourceScope.entries.length);
    assert.equal(networkEvidence.inFlight, 0, 'Installed-review network handlers must drain before certification.');
    if (!config.online) {
      assert.ok(networkEvidence.attemptedMutations >= 1, 'Offline smoke must observe a blocked mutation attempt.');
      assert.ok(networkEvidence.blockedByBudget >= 1, 'Offline smoke must prove the zero mutation budget.');
      assert.equal(networkEvidence.forwardedRequests, 0, 'Offline smoke must not forward admissions.');
      assert.equal(networkEvidence.forwardedRefreshes, 0, 'Offline smoke must not forward refreshes.');
      assert.equal(networkEvidence.receipts, 0, 'Offline smoke must not create mutation receipts.');
      assert.equal(networkEvidence.providerAttempts, 0, 'The extension must not contact providers directly.');
      assert.equal(networkEvidence.foreignAttempts, 0, 'The extension must not contact foreign origins.');
      assert.equal(networkEvidence.webSocketAttempts, 0, 'The extension must not open WebSockets.');
      assert.equal(networkEvidence.readSlots, 0, 'Offline smoke must not consume online read slots.');
    }
    const verdict = installedVerdict(final.aggregate, session.expected, config.online);
    if (verdict === 'offline-regression-passed' && config.favoritesExport === undefined) {
      const unsupported = bookmarks.filter((item) => item.url.includes('/search/')).length;
      assert.equal(final.aggregate.counts.unsupported, unsupported);
      assert.equal(final.aggregate.counts.retryable, session.expected - unsupported);
      assert.equal(final.aggregate.counts.resolved, 0);
      assert.equal(final.aggregate.counts.blocked, 0);
      assert.equal(final.aggregate.reviews, 0);
      assert.equal(final.aggregate.library.total, session.expected - unsupported);
    }
    const converged = installedConverged(final.aggregate, session.expected);
    await writeFile(join(descriptorRoot, session.token + '.report.json'), JSON.stringify({ schemaVersion: 2, verdict, converged, dataOrigin, restartsVerified: true, workerRestartObserved, upgradeVerified: upgraded,
      expected: session.expected, version: session.version, network: networkEvidence, observations }, null, 2) + '\n', { mode: 0o600 });
    log({ event: 'installed-result', verdict, converged, network: networkEvidence, restartsVerified: true, workerRestartObserved, selected: session.expected, session: session.token });
    return verdict === 'incomplete' ? 2 : 0;
  } catch (error) {
    await closeContext(false);
    await networkGuard?.drain();
    const networkEvidence = networkGuard?.snapshot();
    const verdict = installedFailureVerdict(error, expired, deadline, Date.now(), networkEvidence?.failure, closeFailure);
    if (session !== undefined) {
      await writeFile(join(descriptorRoot, session.token + '.report.json'), JSON.stringify({ schemaVersion: 2, verdict, dataOrigin, stage, network: networkEvidence, observations }, null, 2) + '\n', { mode: 0o600 });
      log({ event: 'installed-result', verdict, stage, session: session.token, network: networkEvidence, error: error instanceof assert.AssertionError ? 'assertion-failed' : 'stage-unavailable' });
    } else log({ event: 'installed-result', verdict, stage, error: 'input-unavailable' });
    return verdict === 'incomplete' ? 2 : 1;
  } finally {
    clearTimeout(watchdog);
    await closeContext(false);
    await networkGuard?.drain();
    await recoveryObservation?.close();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runInstalledReview(); }
  catch { process.stderr.write('Installed-review configuration or input rejected; no private content logged.\n'); process.exitCode = 1; }
}
