import {
  publicDiscoveryKeySchema,
  PublicDiscoveryError,
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
interface DiscoveryClockStorage {
  get(key: string): Promise<Partial<Record<string, number>>>;
  set(values: Record<string, number>): Promise<void>;
}
const admissionClockKey = 'public-discovery-admission-v1';
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
  private readonly clocks = new Map<string, number>();
  private gate: Promise<unknown> = Promise.resolve();
  private deadline = Infinity;
  setDeadline(deadline: number): void { this.deadline = deadline; }
  constructor(origin: string, private readonly fetcher: PublicDiscoveryFetch = fetch.bind(globalThis), private readonly clockStorage?: DiscoveryClockStorage) {
    this.origin = exactHttpsOrigin(origin);
  }

  private async clock(key: string): Promise<number> {
    if (this.clockStorage === undefined) return this.clocks.get(key) ?? 0;
    const parsed = z.record(z.string(), z.number().finite().nonnegative()).safeParse(await this.clockStorage.get(key));
    return parsed.success ? parsed.data[key] ?? 0 : 0;
  }
  private async saveClock(key: string, value: number): Promise<void> {
    if (this.clockStorage !== undefined) await this.clockStorage.set({ [key]: value });
    this.clocks.set(key, value);
  }
  private async reserveAdmission(): Promise<void> {
    const reserved = this.gate.catch(() => undefined).then(async () => {
      const next = await this.clock(admissionClockKey);
      if (next > Date.now()) throw new PublicDiscoveryError('ADMISSION_WAIT', undefined, new Date(next).toISOString());
      await this.saveClock(admissionClockKey, Date.now() + 6_500);
    });
    this.gate = reserved;
    return reserved;
  }
  private async exchange<T>(url: string, init: RequestInit, schema: z.ZodType<T>, maximumBytes?: number): Promise<T> {
    if (this.deadline - Date.now() < 15_000) throw new PublicDiscoveryError('ADMISSION_WAIT', undefined, new Date(Date.now() + 60_000).toISOString());
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new PublicDiscoveryError('TIMEOUT')); }, 15_000);
    });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await this.fetcher(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          const header = response.headers.get('Retry-After');
          const parsed = header === null ? NaN : /^\d+$/u.test(header) ? Date.now() + Number(header) * 1_000 : Date.parse(header);
          const next = Math.max(Date.now() + 60_000, Number.isFinite(parsed) ? parsed : 0);
          if (response.status === 429) await this.saveClock(admissionClockKey, Math.max(next, await this.clock(admissionClockKey)));
          const code = response.status === 429 ? 'RATE_LIMITED' : response.status === 409 || response.status === 400 ? 'CONTRACT_CONFLICT' : 'SERVICE_UNAVAILABLE';
          throw new PublicDiscoveryError(code, response.status, new Date(next).toISOString());
        }
        try { return await boundedJson(response, schema, maximumBytes); }
        catch { throw new PublicDiscoveryError('INVALID_RESPONSE', response.status); }
      })()]);
    } catch (error) {
      if (error instanceof PublicDiscoveryError) throw error;
      throw new PublicDiscoveryError('NETWORK');
    } finally { clearTimeout(timer); }
  }

  private async read(key: PublicDiscoveryKey): Promise<PublicDiscoveryReadState> {
    const url = new URL('/v3/catalogue/discoveries', this.origin);
    for (const [name, value] of Object.entries(key)) url.searchParams.set(name, value);
    return this.exchange(url.toString(), { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' }, stateSchema);
  }

  async lookup(input: readonly PublicDiscoveryKey[]) {
    const body = publicDiscoveryLookupSubmissionSchema.parse({ keys: input, schemaVersion: 3 });
    const results = await this.exchange(new URL('/v3/catalogue/discoveries/lookup', this.origin).toString(), {
      body: JSON.stringify(body), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    }, lookupResultSchema, 512 * 1024);
    const requested = new Set(body.keys.map((key) => JSON.stringify(key)));
    if (results.length !== requested.size || new Set(results.map(({ key }) => JSON.stringify(key))).size !== results.length
      || results.some(({ key }) => !requested.has(JSON.stringify(key)))) throw new PublicDiscoveryError('INVALID_RESPONSE');
    for (const result of results) this.cache.set(JSON.stringify(result.key), { expiresAt: Date.now() + 25_000, state: result.state });
    return results;
  }

  async requestRefresh(input: PublicDiscoveryKey) {
    const key = publicDiscoveryKeySchema.parse(input);
    await this.reserveAdmission();
    const state = await this.exchange(new URL('/v3/catalogue/discoveries/refreshes', this.origin).toString(), {
      body: JSON.stringify({ key, schemaVersion: 3 }), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    }, stateSchema);
    if (state.state !== 'VERIFIED') throw new PublicDiscoveryError('INVALID_RESPONSE');
    this.cache.set(JSON.stringify(key), { expiresAt: Date.now() + 25_000, state });
    return state;
  }

  async resolveOrRequest(input: PublicDiscoveryKey, inputQuery: PublicDiscoveryQuery): Promise<PublicDiscoveryReadState> {
    const key = publicDiscoveryKeySchema.parse(input);
    const query = publicDiscoveryQuerySchema.parse(inputQuery);
    const cached = this.cache.get(JSON.stringify(key));
    const state = cached !== undefined && cached.expiresAt > Date.now() ? cached.state : await this.read(key);
    if (state.state !== 'MISS' && state.state !== 'PENDING') return state;
    const pendingClock = `public-discovery-pending-v1:${JSON.stringify(key)}`;
    if (state.state === 'PENDING') {
      const due = await this.clock(pendingClock);
      if (due === 0) { await this.saveClock(pendingClock, Date.parse(state.retryAt)); return state; }
      if (due > Date.now()) return { state: 'PENDING', retryAt: new Date(due).toISOString() };
    }
    await this.reserveAdmission();
    // Persist before I/O: suspension cannot create an immediate resubmission loop.
    await this.saveClock(pendingClock, Date.now() + 60_000);
    const admitted = await this.exchange(new URL('/v3/catalogue/discoveries/requests', this.origin).toString(), {
      body: JSON.stringify({ key, query, schemaVersion: 3 }), cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    }, stateSchema);
    if (admitted.state === 'PENDING') {
      const next = Math.max(Date.now() + 60_000, Date.parse(admitted.retryAt));
      await this.saveClock(pendingClock, next);
      admitted.retryAt = new Date(next).toISOString();
    }
    this.cache.set(JSON.stringify(key), { expiresAt: Date.now() + 25_000, state: admitted });
    return admitted;
  }
}
