import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { publicDiscoveryFailureDiagnosticSchema, publicDiscoveryKeyV3Schema, publicDiscoveryQuerySchema, publicDiscoveryTerminalResolutionSchema } from '../../packages/public-discovery/src/contracts.ts';
import { executeAdminQuery, readAdminJson, validateAdminScope } from './discovery-admin.mjs';

const execFileAsync = promisify(execFile);
const traceIdSchema = z.uuid();
const eventIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const tracePointerSchema = z.strictObject({ eventId: eventIdSchema, requestDigest: z.string().regex(/^[a-f0-9]{64}$/u), diagnostic: z.string().max(16_384) });
const requestHeadersSchema = z.array(z.strictObject({
  name: z.enum(['accept', 'content-type', 'origin', 'referer', 'user-agent']), value: z.string().max(256),
})).max(5);
const responseHeadersSchema = z.array(z.strictObject({
  name: z.enum(['cf-ray', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'request-id', 'retry-after',
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-request-id']), value: z.string().max(256),
})).max(10);
function isAllowedTraceTarget(target, method) {
  let url;
  try { url = new URL(target); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  if (url.origin === 'https://graphql.anilist.co') return method === 'POST' && url.pathname === '/' && url.search === '';
  if (url.origin === 'https://api.mangaupdates.com') {
    if (method === 'POST' && ['/v1/releases/search', '/v1/series/search'].includes(url.pathname)) return url.search === '';
    return method === 'GET' && /^\/v1\/series\/[1-9]\d{0,18}$/u.test(url.pathname) && url.search === '';
  }
  if (url.origin === 'https://api.mangadex.org' && method === 'GET') {
    if (url.searchParams.has('ids[]')) return url.pathname === '/manga' && url.searchParams.size === 2
      && url.searchParams.get('limit') === '1' && url.searchParams.get('ids[]') === '00000000-0000-4000-8000-000000000000';
    const pathAllowed = url.pathname === '/manga' || /^\/manga\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(url.pathname);
    return pathAllowed && [...url.searchParams.keys()].every(key => ['title', 'limit', 'offset', 'includes[]'].includes(key));
  }
  if (url.origin === 'https://kitsu.io' && method === 'GET') {
    const path = /^\/api\/edge\/(anime|manga)(\/\d+)?$/u.exec(url.pathname);
    if (path === null) return false;
    const allowed = new Set(['filter[text]', 'page[limit]', 'page[offset]', `fields[${path[1]}]`]);
    if (url.searchParams.has('include') || url.searchParams.has('fields[mappings]')) {
      if (path[1] !== 'anime' || url.searchParams.getAll('include').length !== 1 || url.searchParams.get('include') !== 'mappings'
        || url.searchParams.getAll('fields[mappings]').length !== 1 || url.searchParams.get('fields[mappings]') !== 'externalSite,externalId') return false;
      allowed.add('include'); allowed.add('fields[mappings]');
    }
    return [...url.searchParams.keys()].every(key => allowed.has(key));
  }
  return false;
}
const exchangeSchema = z.strictObject({
  contentType: z.string().max(128).optional(),
  method: z.enum(['GET', 'POST']),
  requestHeaders: requestHeadersSchema.optional(),
  requestBody: z.string().max(8 * 1024).optional(),
  responseHeaders: responseHeadersSchema.optional(),
  responseBody: z.string().max(8 * 1024).optional(),
  responseStatus: z.number().int().min(100).max(599).optional(),
  target: z.string().url().max(4096),
  transportFailure: z.enum(['aborted', 'network-error', 'timeout']).optional(),
  truncated: z.boolean(),
}).superRefine((exchange, context) => {
  if (!isAllowedTraceTarget(exchange.target, exchange.method)) context.addIssue({ code: 'custom', message: 'provider-trace-target-not-allowlisted' });
});
const providerTraceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  traceId: z.uuid(),
  correlationId: z.uuid(),
  observedAt: z.iso.datetime({ offset: false }),
  key: publicDiscoveryKeyV3Schema,
  query: publicDiscoveryQuerySchema,
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  attempt: z.number().int().min(1).max(8),
  resolution: publicDiscoveryTerminalResolutionSchema.optional(),
  exchanges: z.array(exchangeSchema).max(16),
});
const maximumTraceBytes = 512 * 1024;

export function failureTracePointerQuery(input, ordinal, eventId, traceId) {
  const scope = validateAdminScope(input);
  z.number().int().min(1).max(scope.entries.length).parse(ordinal);
  eventIdSchema.parse(eventId);
  traceIdSchema.parse(traceId);
  const key = scope.entries[ordinal - 1].key;
  return `SELECT event_id AS eventId, request_digest AS requestDigest, diagnostic_json AS diagnostic
    FROM public_discovery_failure_events INDEXED BY public_discovery_failure_events_key
    WHERE fingerprint = '${key.fingerprint}' AND media_kind = '${key.mediaKind}'
      AND parser_version = '${key.parserVersion}' AND rules_version = '${key.siteRulesVersion}'
      AND event_id = ${eventId} AND json_extract(diagnostic_json, '$.traceId') = '${traceId}' LIMIT 1`;
}

export async function retrieveFailureTrace(input, ordinal, eventId, traceId, {
  readPointer = query => executeAdminQuery(query),
  fetchObject,
  directory = 'build/audits',
} = {}) {
  const scope = validateAdminScope(input);
  z.number().int().min(1).max(scope.entries.length).parse(ordinal);
  eventIdSchema.parse(eventId);
  traceIdSchema.parse(traceId);
  if (!z.function().safeParse(fetchObject).success) throw new Error('failure-trace-reader-required');
  const result = await readPointer(failureTracePointerQuery(scope, ordinal, eventId, traceId));
  if (!Number.isSafeInteger(result?.meta?.rows_read) || result.meta.rows_read < 0 || result.meta.rows_read > 8
    || result.meta.rows_written !== 0 || result.meta.changes !== 0 || result.meta.changed_db === true) throw new Error('failure-trace-pointer-cost');
  const pointers = z.array(tracePointerSchema).max(1).parse(result.rows);
  if (pointers.length !== 1) throw new Error('failure-trace-pointer-missing');
  const pointer = pointers[0];
  const diagnostic = publicDiscoveryFailureDiagnosticSchema.parse(JSON.parse(pointer.diagnostic));
  if (diagnostic.traceId !== traceId) throw new Error('failure-trace-pointer-mismatch');
  const key = scope.entries[ordinal - 1].key;
  const requestDigest = pointer.requestDigest;
  const body = await fetchObject(`tobirink-discovery-audit/provider-audit/v1/${traceId}.json`);
  const bytes = Buffer.from(body);
  if (bytes.length > maximumTraceBytes) throw new Error('failure-trace-size-limit');
  const trace = providerTraceSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (trace.traceId !== traceId || trace.key.fingerprint !== key.fingerprint || trace.key.mediaKind !== key.mediaKind
    || trace.key.parserVersion !== key.parserVersion || trace.key.siteRulesVersion !== key.siteRulesVersion
    || trace.requestDigest !== requestDigest) {
    throw new Error('failure-trace-scope-mismatch');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const root = await mkdtemp(resolve(directory, 'provider-trace-'));
  const path = resolve(root, `${traceId}.json`);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(`${JSON.stringify(trace, null, 2)}\n`); } finally { await file.close(); }
  await chmod(path, 0o600);
  if ((await stat(path)).size > maximumTraceBytes) {
    await rm(root, { recursive: true, force: true });
    throw new Error('failure-trace-size-limit');
  }
  return { file: path, traceId, sha256: createHash('sha256').update(bytes).digest('hex'), rowsRead: result.meta.rows_read, rowsWritten: 0 };
}

export async function runFailureTrace(args, { output = value => process.stdout.write(`${value}\n`) } = {}) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--scope', '--request', '--event', '--trace-id', '--local-oauth'].includes(flag)
      || !value || value.startsWith('--') || Object.hasOwn(options, flag)) throw new Error('failure-trace-arguments-invalid');
    options[flag] = value;
  }
  if (!options['--scope'] || !/^[1-9]\d{0,3}$/u.test(options['--request'] ?? '')
    || !/^[1-9]\d{0,15}$/u.test(options['--event'] ?? '') || !traceIdSchema.safeParse(options['--trace-id']).success
    || !['true', 'false'].includes(options['--local-oauth'] ?? 'false')) throw new Error('failure-trace-arguments-invalid');
  const report = await retrieveFailureTrace(await readAdminJson(options['--scope']), Number(options['--request']), Number(options['--event']), options['--trace-id'], {
    readPointer: query => executeAdminQuery(query, { localOAuth: options['--local-oauth'] === 'true' }),
    fetchObject: async objectPath => {
      const root = fileURLToPath(new URL('../../', import.meta.url));
      const destination = resolve(root, 'build/audits', `.provider-trace-${options['--trace-id']}.json`);
      await mkdir(resolve(root, 'build/audits'), { recursive: true, mode: 0o700 });
      await chmod(resolve(root, 'build/audits'), 0o700);
      try {
        await execFileAsync('npm', ['exec', '--', 'wrangler', 'r2', 'object', 'get', objectPath, '--remote', '--file', destination], {
          cwd: resolve(root, 'apps/worker'), encoding: 'utf8', maxBuffer: 16 * 1024, timeout: 30_000,
          env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        });
        await chmod(destination, 0o600);
        const bytes = await readFile(destination);
        await rm(destination, { force: true });
        return bytes;
      } catch {
        await rm(destination, { force: true });
        throw new Error('failure-trace-r2-read-failed');
      }
    },
  });
  output(JSON.stringify(report));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runFailureTrace(process.argv.slice(2)).catch(() => {
    process.stderr.write('failure-trace-failed: vérifier le scope, le pointeur D1 et l’accès R2 ; aucune mutation effectuée.\n');
    process.exitCode = 1;
  });
}
