import type { ProviderTransportPort } from '@tobirink/public-discovery';

const requestByteLimit = 64 * 1024;
const minimumSecretBytes = 32;
const maximumSecretBytes = 256;

type ProviderMethod = 'GET' | 'POST';
type TransportFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ProviderTransportBindings {
  readonly PROVIDER_GATEWAY_HMAC_KEY?: string;
  readonly PROVIDER_GATEWAY_ORIGIN?: string;
  readonly PROVIDER_TRANSPORT_MODE?: string;
}

export interface ProviderTransportAdapterOptions {
  readonly fetcher?: TransportFetch;
  readonly nonce?: () => string;
  readonly now?: () => number;
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function methodOf(init: RequestInit): ProviderMethod {
  if (init.method === 'GET' || init.method === 'POST') return init.method;
  throw new TypeError('provider-transport-method');
}

function onlyQueryKeys(url: URL, allowed: ReadonlySet<string>): boolean {
  return [...url.searchParams.keys()].every((key) => allowed.has(key));
}

export function isAllowedProviderTarget(target: string, method: ProviderMethod): boolean {
  let url: URL;
  try { url = new URL(target); } catch { return false; }
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

function assertGatewayOrigin(value: string | undefined): string {
  if (value === undefined) throw new Error('provider-gateway-origin-required');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new TypeError('provider-gateway-origin');
  return url.origin;
}

function assertGatewaySecret(value: string | undefined): string {
  if (value === undefined) throw new Error('provider-gateway-secret-required');
  const length = bytes(value);
  if (length < minimumSecretBytes || length > maximumSecretBytes) throw new TypeError('provider-gateway-secret');
  return value;
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class DirectProviderTransportAdapter implements ProviderTransportPort {
  constructor(private readonly fetcher: TransportFetch = fetch.bind(globalThis)) {}

  async fetch(target: string, init: RequestInit): Promise<Response> {
    if (!isAllowedProviderTarget(target, methodOf(init))) throw new TypeError('provider-transport-target');
    return this.fetcher(target, { ...init, cache: 'no-store', redirect: 'error' });
  }
}

export class SignedGatewayProviderTransportAdapter implements ProviderTransportPort {
  private readonly fetcher: TransportFetch;
  private readonly nonce: () => string;
  private readonly now: () => number;
  private readonly origin: string;
  private readonly secret: string;

  constructor(input: { readonly origin: string; readonly secret: string } & ProviderTransportAdapterOptions) {
    this.origin = assertGatewayOrigin(input.origin);
    this.secret = assertGatewaySecret(input.secret);
    this.fetcher = input.fetcher ?? fetch.bind(globalThis);
    this.nonce = input.nonce ?? crypto.randomUUID;
    this.now = input.now ?? Date.now;
  }

  async fetch(target: string, init: RequestInit): Promise<Response> {
    const method = methodOf(init);
    if (!isAllowedProviderTarget(target, method)) throw new TypeError('provider-transport-target');
    if (method === 'GET' && init.body != null) throw new TypeError('provider-gateway-body');
    if (method === 'POST' && init.body == null) throw new TypeError('provider-gateway-body');
    const body = method === 'POST' ? await new Response(init.body).text() : null;
    const raw = JSON.stringify({ body, issuedAt: new Date(this.now()).toISOString(), method, nonce: this.nonce(), target, version: 1 });
    if (bytes(raw) > requestByteLimit) throw new RangeError('provider-gateway-request-too-large');
    const request: RequestInit = {
      body: raw,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Tobirink-Gateway-Signature': await hmac(this.secret, raw),
      },
      method: 'POST',
      redirect: 'error',
    };
    if (init.signal !== undefined) request.signal = init.signal;
    return this.fetcher(`${this.origin}/v1/provider-fetch`, request);
  }
}

export function createProviderTransportAdapter(bindings: ProviderTransportBindings, options: ProviderTransportAdapterOptions = {}): ProviderTransportPort {
  const mode = bindings.PROVIDER_TRANSPORT_MODE ?? 'direct';
  if (mode === 'direct') return new DirectProviderTransportAdapter(options.fetcher);
  if (mode === 'gateway') {
    return new SignedGatewayProviderTransportAdapter({
      ...options,
      origin: assertGatewayOrigin(bindings.PROVIDER_GATEWAY_ORIGIN),
      secret: assertGatewaySecret(bindings.PROVIDER_GATEWAY_HMAC_KEY),
    });
  }
  throw new TypeError('provider-transport-mode');
}
