import type { FavoriteProviderFetch } from './provider-http.js';
import { z } from 'zod';

const requestByteLimit = 64 * 1024;
const responseByteLimit = 512 * 1024;
const clockSkewMilliseconds = 60_000;
const nonceLimit = 1_024;

const providerProxyEnvelopeSchema = z.strictObject({
  body: z.string().refine((value) => bytes(value) <= requestByteLimit).nullable(),
  issuedAt: z.iso.datetime({ offset: false }),
  method: z.enum(['GET', 'POST']),
  nonce: z.uuid(),
  target: z.string().max(2_048),
  version: z.literal(1),
}).refine((value) => (value.method === 'GET') === (value.body === null));
type ProviderProxyEnvelope = z.infer<typeof providerProxyEnvelopeSchema>;

export interface ProviderProxyNonceStore { consume(nonce: string, expiresAt: number): boolean }

export class BoundedProviderProxyNonceStore implements ProviderProxyNonceStore {
  private readonly entries = new Map<string, number>();
  constructor(private readonly maximum = nonceLimit, private readonly now: () => number = Date.now) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > nonceLimit) throw new RangeError('provider-proxy-nonce-limit');
  }
  consume(nonce: string, expiresAt: number): boolean {
    const current = this.now();
    for (const [key, expiry] of this.entries) if (expiry <= current) this.entries.delete(key);
    if (this.entries.has(nonce)) return false;
    if (this.entries.size >= this.maximum) return false;
    this.entries.set(nonce, expiresAt);
    return true;
  }
}

function bytes(value: string): number { return new TextEncoder().encode(value).byteLength; }

async function hmac(secret: string, value: string): Promise<string> {
  if (bytes(secret) < 32 || bytes(secret) > 256) throw new TypeError('provider-proxy-key');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(left) || right.length !== left.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function onlyQueryKeys(url: URL, allowed: ReadonlySet<string>): boolean {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

export function isAllowedProviderTarget(target: string, method: 'GET' | 'POST'): boolean {
  let url: URL;
  try { url = new URL(target); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  if (url.origin === 'https://graphql.anilist.co') return method === 'POST' && url.pathname === '/' && url.search === '';
  if (url.origin === 'https://api.mangaupdates.com') {
    if (method === 'POST' && ['/v1/releases/search', '/v1/series/search'].includes(url.pathname)) return url.search === '';
    return method === 'GET' && /^\/v1\/series\/[1-9]\d{0,18}$/u.test(url.pathname) && url.search === '';
  }
  if (url.origin === 'https://api.mangadex.org' && method === 'GET') {
    const path = url.pathname === '/manga' || /^\/manga\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(url.pathname);
    return path && onlyQueryKeys(url, new Set(['title', 'limit', 'offset', 'includes[]']));
  }
  if (url.origin === 'https://kitsu.io' && method === 'GET') {
    const path = /^\/api\/edge\/(anime|manga)(\/\d+)?$/u.exec(url.pathname);
    return path !== null && onlyQueryKeys(url, new Set(['filter[text]', 'page[limit]', 'page[offset]', `fields[${path[1]}]`]));
  }
  return false;
}

function proxyError(error: string, status: number): Response {
  return Response.json({ error }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status });
}

async function boundedResponse(response: Response): Promise<Response> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > responseByteLimit) throw new Error('provider-proxy-response-too-large');
  const body = await response.arrayBuffer();
  if (body.byteLength > responseByteLimit) throw new Error('provider-proxy-response-too-large');
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  const contentType = response.headers.get('content-type'); const retryAfter = response.headers.get('retry-after');
  if (contentType) headers.set('Content-Type', contentType);
  if (retryAfter && retryAfter.length <= 128) headers.set('Retry-After', retryAfter);
  return new Response(body, { headers, status: response.status });
}

export function createProviderProxyHandler(input: { readonly fetcher?: typeof fetch; readonly nonceStore?: ProviderProxyNonceStore; readonly now?: () => number; readonly secret: string }) {
  const fetcher = input.fetcher ?? fetch.bind(globalThis); const now = input.now ?? Date.now;
  const nonceStore = input.nonceStore ?? new BoundedProviderProxyNonceStore(nonceLimit, now);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/provider-fetch' || url.search) return proxyError('not-found', 404);
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > requestByteLimit) return proxyError('body-too-large', 413);
    const raw = await request.text();
    if (bytes(raw) > requestByteLimit) return proxyError('body-too-large', 413);
    const signature = request.headers.get('X-Tobirink-Proxy-Signature') ?? '';
    if (!equalHex(signature, await hmac(input.secret, raw))) return proxyError('unauthorized', 401);
    let decoded: object | undefined;
    try { decoded = JSON.parse(raw); } catch { decoded = undefined; }
    const parsedEnvelope = providerProxyEnvelopeSchema.safeParse(decoded);
    if (!parsedEnvelope.success) return proxyError('invalid-request', 400);
    const parsed = parsedEnvelope.data;
    const issuedAt = Date.parse(parsed.issuedAt);
    if (!Number.isFinite(issuedAt) || Math.abs(now() - issuedAt) > clockSkewMilliseconds) return proxyError('expired-request', 401);
    if (!isAllowedProviderTarget(parsed.target, parsed.method)) return proxyError('target-not-allowed', 403);
    if (!nonceStore.consume(parsed.nonce, issuedAt + clockSkewMilliseconds)) return proxyError('replayed-request', 409);
    const target = new URL(parsed.target);
    const headers = new Headers({ Accept: target.origin === 'https://kitsu.io' ? 'application/vnd.api+json' : 'application/json', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' });
    if (parsed.method === 'POST') headers.set('Content-Type', 'application/json');
    if (target.origin === 'https://graphql.anilist.co') { headers.set('Origin', 'https://tobirink.com'); headers.set('Referer', 'https://tobirink.com/'); }
    try { return await boundedResponse(await fetcher(target.toString(), { body: parsed.body, cache: 'no-store', headers, method: parsed.method, redirect: 'error', signal: AbortSignal.timeout(10_000) })); }
    catch { return proxyError('upstream-unavailable', 502); }
  };
}

export function createSignedProviderProxyFetch(input: { readonly fetcher?: typeof fetch; readonly nonce?: () => string; readonly now?: () => number; readonly origin: string; readonly secret: string }): FavoriteProviderFetch {
  const originUrl = new URL(input.origin);
  if (originUrl.protocol !== 'https:' || originUrl.origin !== input.origin || originUrl.username || originUrl.password) throw new TypeError('provider-proxy-origin');
  const fetcher = input.fetcher ?? fetch.bind(globalThis); const nonce = input.nonce ?? crypto.randomUUID; const now = input.now ?? Date.now;
  return async (target, init) => {
    const parsedMethod = z.enum(['GET', 'POST']).safeParse(init.method);
    if (!parsedMethod.success || !isAllowedProviderTarget(target, parsedMethod.data)) throw new TypeError('provider-proxy-target');
    const method = parsedMethod.data;
    const parsedBody = method === 'POST' ? z.string().safeParse(init.body) : { data: null, success: true } as const;
    if (!parsedBody.success) throw new TypeError('provider-proxy-body');
    const body = parsedBody.data;
    const raw = JSON.stringify({ body, issuedAt: new Date(now()).toISOString(), method, nonce: nonce(), target, version: 1 } satisfies ProviderProxyEnvelope);
    if (bytes(raw) > requestByteLimit) throw new RangeError('provider-proxy-request-too-large');
    const proxyRequest: RequestInit = { body: raw, cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Tobirink-Proxy-Signature': await hmac(input.secret, raw) }, method: 'POST', redirect: 'error' };
    if (init.signal !== undefined) proxyRequest.signal = init.signal;
    return fetcher(`${originUrl.origin}/v1/provider-fetch`, proxyRequest);
  };
}
