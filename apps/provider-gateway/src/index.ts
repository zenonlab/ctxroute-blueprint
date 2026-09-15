const requestByteLimit = 64 * 1024;
const responseByteLimit = 512 * 1024;
const replayWindowMs = 60_000;
const minimumSecretBytes = 32;
const maximumSecretBytes = 256;

type ProviderMethod = 'GET' | 'POST';
type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

interface GatewayEnvelope {
  readonly body: string | null;
  readonly issuedAt: string;
  readonly method: ProviderMethod;
  readonly nonce: string;
  readonly target: string;
  readonly version: 1;
}

export interface GatewayNonceStore {
  claim(nonce: string, expiresAt: number): Promise<boolean>;
}

interface GatewayOptions {
  readonly fetcher?: ProviderFetch;
  readonly nonceStore: GatewayNonceStore;
  readonly now?: () => number;
  readonly secret: string;
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function json(status: number, code: string): Response {
  return Response.json({ error: code }, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
    },
    status,
  });
}

function onlyQueryKeys(url: URL, allowed: ReadonlySet<string>): boolean {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

export function isAllowedProviderTarget(target: string, method: ProviderMethod): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
  if (url.origin === 'https://graphql.anilist.co') return method === 'POST' && url.pathname === '/' && url.search === '';
  if (url.origin === 'https://api.mangaupdates.com') {
    if (method === 'POST' && ['/v1/releases/search', '/v1/series/search'].includes(url.pathname)) return url.search === '';
    return method === 'GET' && /^\/v1\/series\/[1-9]\d{0,18}$/u.test(url.pathname) && url.search === '';
  }
  if (url.origin === 'https://api.mangadex.org' && method === 'GET') {
    const pathAllowed = url.pathname === '/manga' || /^\/manga\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(url.pathname);
    return pathAllowed && onlyQueryKeys(url, new Set(['title', 'limit', 'offset', 'includes[]']));
  }
  if (url.origin === 'https://kitsu.io' && method === 'GET') {
    const path = /^\/api\/edge\/(anime|manga)(\/\d+)?$/u.exec(url.pathname);
    return path !== null && onlyQueryKeys(url, new Set(['filter[text]', 'page[limit]', 'page[offset]', `fields[${path[1]}]`]));
  }
  return false;
}

async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (stream === null) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new RangeError('body-too-large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const value = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return value;
}

async function hmac(secret: string, value: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, value));
}

function decodeHex(value: string): Uint8Array | undefined {
  if (!/^[a-f0-9]{64}$/u.test(value)) return undefined;
  const result = new Uint8Array(32);
  for (let index = 0; index < result.length; index += 1) result[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return result;
}

function equalConstantTime(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

const gatewayEnvelopeSchema = z.strictObject({
  body: z.string().nullable(),
  issuedAt: z.iso.datetime({ offset: false }),
  method: z.enum(['GET', 'POST']),
  nonce: z.uuid(),
  target: z.url(),
  version: z.literal(1),
}).superRefine((value, context) => {
  if (value.method === 'GET' ? value.body !== null : value.body === null) context.addIssue({ code: 'custom', message: 'body does not match method' });
  if (!isAllowedProviderTarget(value.target, value.method)) context.addIssue({ code: 'custom', message: 'provider target is not allowed' });
});

function parseEnvelope(raw: Uint8Array, now: number): GatewayEnvelope | undefined {
  let parsed: object;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    return undefined;
  }
  const result = gatewayEnvelopeSchema.safeParse(parsed);
  if (!result.success) return undefined;
  const issuedAt = Date.parse(result.data.issuedAt);
  if (Math.abs(now - issuedAt) > replayWindowMs) return undefined;
  return result.data;
}

function providerHeaders(envelope: GatewayEnvelope): Headers {
  const origin = new URL(envelope.target).origin;
  const headers = new Headers({
    Accept: origin === 'https://kitsu.io' ? 'application/vnd.api+json' : 'application/json',
  });
  if (envelope.method === 'POST') headers.set('Content-Type', 'application/json');
  if (origin === 'https://graphql.anilist.co') {
    headers.set('Origin', 'https://tobirink.com');
    headers.set('Referer', 'https://tobirink.com/');
    headers.set('User-Agent', 'TobiRink/1.0 (+https://tobirink.com)');
  }
  return headers;
}

function forwardedHeaders(response: Response): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': response.headers.get('content-type') ?? 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export class DenoKvNonceStore implements GatewayNonceStore {
  constructor(private readonly kv: Deno.Kv, private readonly now: () => number = Date.now) {}

  async claim(nonce: string, expiresAt: number): Promise<boolean> {
    const key = ['provider-gateway-nonce', nonce] as const;
    const current = await this.kv.get(key);
    if (current.value !== null) return false;
    const expireIn = Math.max(1, expiresAt - this.now());
    return (await this.kv.atomic().check(current).set(key, expiresAt, { expireIn }).commit()).ok;
  }
}

export function createProviderGatewayHandler(options: GatewayOptions): (request: Request) => Promise<Response> {
  if (bytes(options.secret) < minimumSecretBytes || bytes(options.secret) > maximumSecretBytes) throw new TypeError('gateway-secret');
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const now = options.now ?? Date.now;
  return async (request) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz' && url.search === '') return json(200, 'healthy');
    if (request.method !== 'POST' || url.pathname !== '/v1/provider-fetch' || url.search !== '') return json(404, 'not-found');
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > requestByteLimit) return json(413, 'request-too-large');
    let raw: Uint8Array<ArrayBuffer>;
    try {
      raw = await readBounded(request.body, requestByteLimit);
    } catch {
      return json(413, 'request-too-large');
    }
    const provided = decodeHex(request.headers.get('x-tobirink-gateway-signature') ?? '');
    if (provided === undefined || !equalConstantTime(provided, await hmac(options.secret, raw))) return json(401, 'invalid-signature');
    const currentTime = now();
    const envelope = parseEnvelope(raw, currentTime);
    if (envelope === undefined) return json(400, 'invalid-envelope');
    if (!await options.nonceStore.claim(envelope.nonce, currentTime + replayWindowMs)) return json(409, 'replayed-request');
    let upstream: Response;
    try {
      upstream = await fetcher(envelope.target, {
        body: envelope.body,
        cache: 'no-store',
        headers: providerHeaders(envelope),
        method: envelope.method,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return json(502, 'provider-unavailable');
    }
    const upstreamLength = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(upstreamLength) && upstreamLength > responseByteLimit) return json(502, 'provider-response-too-large');
    try {
      const body = await readBounded(upstream.body, responseByteLimit);
      return new Response(body.buffer, { headers: forwardedHeaders(upstream), status: upstream.status });
    } catch {
      return json(502, 'provider-response-too-large');
    }
  };
}

export function createUnconfiguredGatewayHandler(): (request: Request) => Promise<Response> {
  return (_request) => Promise.resolve(json(503, 'gateway-not-configured'));
}

if (import.meta.main) {
  const secret = Deno.env.get('PROVIDER_GATEWAY_HMAC_KEY');
  let handler: (request: Request) => Promise<Response>;
  if (secret === undefined) {
    handler = createUnconfiguredGatewayHandler();
  } else {
    const kv = await Deno.openKv();
    handler = createProviderGatewayHandler({ nonceStore: new DenoKvNonceStore(kv), secret });
  }
  Deno.serve(async (request) => {
    const startedAt = Date.now();
    const response = await handler(request);
    console.log(JSON.stringify({
      durationMs: Math.max(0, Date.now() - startedAt),
      method: request.method,
      path: new URL(request.url).pathname,
      status: response.status,
      type: 'provider-gateway.request',
    }));
    return response;
  });
}
import { z } from 'zod';
