import {
  publicDiscoveryKeySchema,
  type PublicDiscoveryRequestClientPort,
  type PublicDiscoveryKey,
} from '@tobirink/application';
import {
  publicDiscoveryLookupSubmissionSchema,
  publicDiscoveryQuerySchema,
  publicDiscoveryTerminalResolutionSchema,
  type PublicDiscoveryQuery,
  type PublicDiscoveryReadState,
} from '@tobirink/public-discovery';
import { z } from 'zod';

export type PublicDiscoveryFetch = (input: string, init: RequestInit) => Promise<Response>;
const stateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('MISS') }),
  z.strictObject({ retryAt: z.iso.datetime({ offset: false }), state: z.literal('PENDING') }),
  z.strictObject({ reason: z.literal('ATTEMPT_LIMIT'), state: z.literal('UNAVAILABLE') }),
  z.strictObject({ nextRefreshAt: z.iso.datetime({ offset: false }), profile: publicDiscoveryTerminalResolutionSchema.options[0].shape.profile, state: z.literal('VERIFIED'), verifiedAt: z.iso.datetime({ offset: false }) }),
  z.strictObject({ reason: z.string().min(1).max(200), state: z.literal('NOT_FOUND'), verifiedAt: z.iso.datetime({ offset: false }) }),
  z.strictObject({ candidates: publicDiscoveryTerminalResolutionSchema.options[2].shape.candidates, reason: z.string().min(1).max(200), state: z.literal('AMBIGUOUS'), verifiedAt: z.iso.datetime({ offset: false }) }),
]);
const lookupResultSchema = z.array(z.strictObject({ key: publicDiscoveryKeySchema, state: stateSchema })).min(1).max(50);

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== '') throw new TypeError('Public discovery API must be an exact HTTPS origin.');
  return url.origin;
}

async function boundedJson<T>(response: Response, schema: z.ZodType<T>, maximumBytes = 64 * 1024): Promise<T> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) throw new Error('Public discovery response exceeds its byte limit.');
  return schema.parse(JSON.parse(text));
}

export class HttpPublicDiscoveryAdapter implements PublicDiscoveryRequestClientPort {
  private readonly origin: string;
  private readonly cache = new Map<string, { expiresAt: number; state: PublicDiscoveryReadState }>();
  constructor(origin: string, private readonly fetcher: PublicDiscoveryFetch = fetch.bind(globalThis)) {
    this.origin = exactHttpsOrigin(origin);
  }

  private async read(key: PublicDiscoveryKey): Promise<PublicDiscoveryReadState> {
    const url = new URL('/v3/catalogue/discoveries', this.origin);
    for (const [name, value] of Object.entries(key)) url.searchParams.set(name, value);
    const response = await this.fetcher(url.toString(), { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Public discovery read failed with status ${response.status}.`);
    return boundedJson(response, stateSchema);
  }

  async lookup(input: readonly PublicDiscoveryKey[]) {
    const body = publicDiscoveryLookupSubmissionSchema.parse({ keys: input, schemaVersion: 3 });
    const response = await this.fetcher(new URL('/v3/catalogue/discoveries/lookup', this.origin).toString(), {
      body: JSON.stringify(body), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Public discovery lookup failed with status ${response.status}.`);
    const results = await boundedJson(response, lookupResultSchema, 512 * 1024);
    const requested = new Set(body.keys.map((key) => JSON.stringify(key)));
    if (results.length !== requested.size || new Set(results.map(({ key }) => JSON.stringify(key))).size !== results.length
      || results.some(({ key }) => !requested.has(JSON.stringify(key)))) throw new Error('Public discovery lookup correlation failed.');
    for (const result of results) this.cache.set(JSON.stringify(result.key), { expiresAt: Date.now() + 25_000, state: result.state });
    return results;
  }

  async requestRefresh(input: PublicDiscoveryKey) {
    const key = publicDiscoveryKeySchema.parse(input);
    const response = await this.fetcher(new URL('/v3/catalogue/discoveries/refreshes', this.origin).toString(), {
      body: JSON.stringify({ key, schemaVersion: 3 }), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Public discovery refresh failed with status ${response.status}.`);
    const state = await boundedJson(response, stateSchema);
    if (state.state !== 'VERIFIED') throw new Error('Public discovery refresh did not preserve VERIFIED.');
    this.cache.set(JSON.stringify(key), { expiresAt: Date.now() + 25_000, state });
    return state;
  }

  async resolveOrRequest(input: PublicDiscoveryKey, inputQuery: PublicDiscoveryQuery): Promise<PublicDiscoveryReadState> {
    const key = publicDiscoveryKeySchema.parse(input);
    const query = publicDiscoveryQuerySchema.parse(inputQuery);
    const cached = this.cache.get(JSON.stringify(key));
    const state = cached !== undefined && cached.expiresAt > Date.now() ? cached.state : await this.read(key);
    if (state.state !== 'MISS') return state;
    const response = await this.fetcher(new URL('/v3/catalogue/discoveries/requests', this.origin).toString(), {
      body: JSON.stringify({ key, query, schemaVersion: 3 }), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Public discovery request failed with status ${response.status}.`);
    return boundedJson(response, stateSchema);
  }
}
