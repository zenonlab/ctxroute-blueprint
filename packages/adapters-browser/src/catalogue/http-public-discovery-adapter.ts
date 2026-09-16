import {
  publicDiscoveryKeySchema,
  type PublicDiscoveryRequestClientPort,
  type PublicDiscoveryKey,
} from '@tobirink/application';
import {
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

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== '') throw new TypeError('Public discovery API must be an exact HTTPS origin.');
  return url.origin;
}

async function boundedJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error('Public discovery response exceeds its byte limit.');
  return schema.parse(JSON.parse(text));
}

export class HttpPublicDiscoveryAdapter implements PublicDiscoveryRequestClientPort {
  private readonly origin: string;
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

  async resolveOrRequest(input: PublicDiscoveryKey, inputQuery: PublicDiscoveryQuery): Promise<PublicDiscoveryReadState> {
    const key = publicDiscoveryKeySchema.parse(input);
    const query = publicDiscoveryQuerySchema.parse(inputQuery);
    const state = await this.read(key);
    if (state.state !== 'MISS') return state;
    const response = await this.fetcher(new URL('/v3/catalogue/discoveries/requests', this.origin).toString(), {
      body: JSON.stringify({ key, query, schemaVersion: 3 }), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Public discovery request failed with status ${response.status}.`);
    return boundedJson(response, stateSchema);
  }
}
