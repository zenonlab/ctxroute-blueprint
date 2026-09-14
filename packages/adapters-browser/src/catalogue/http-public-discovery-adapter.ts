import {
  publicDiscoveryKeySchema,
  publicDiscoveryProfileSchema,
  publicDiscoveryReferenceSchema,
  type PublicDiscoveryClientPort,
  type PublicDiscoveryClientState,
  type PublicDiscoveryKey,
  type PublicDiscoveryLocalRecord,
  type PublicDiscoveryLocalStore,
  type PublicDiscoveryReference,
} from '@tobirink/application';
import { z } from 'zod';

export type PublicDiscoveryFetch = (input: string, init: RequestInit) => Promise<Response>;
const stateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('MISS') }),
  z.strictObject({ retryAt: z.iso.datetime({ offset: false }), state: z.literal('PENDING') }),
  z.strictObject({ profile: publicDiscoveryProfileSchema, state: z.literal('VERIFIED'), verifiedAt: z.iso.datetime({ offset: false }) }),
  z.strictObject({ expiresAt: z.iso.datetime({ offset: false }), leaseToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u), state: z.literal('LEASED') }),
]);
const proposalReceiptSchema = z.strictObject({ proposalDigest: z.string().regex(/^[a-f0-9]{64}$/u), state: z.literal('PENDING') });

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== '') throw new TypeError('Public discovery API must be an exact HTTPS origin.');
  return url.origin;
}

function recordId(key: PublicDiscoveryKey): string {
  return JSON.stringify([key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion]);
}

async function boundedJson<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error('Public discovery response exceeds its byte limit.');
  return schema.parse(JSON.parse(text));
}

export class HttpPublicDiscoveryAdapter implements PublicDiscoveryClientPort {
  private readonly origin: string;
  constructor(origin: string, private readonly local: PublicDiscoveryLocalStore, private readonly fetcher: PublicDiscoveryFetch = fetch.bind(globalThis), private readonly now = Date.now) {
    this.origin = exactHttpsOrigin(origin);
  }

  private async requestState(key: PublicDiscoveryKey): Promise<PublicDiscoveryClientState & { leaseToken?: string }> {
    const url = new URL('/v2/catalogue/discoveries', this.origin);
    for (const [name, value] of Object.entries(key)) url.searchParams.set(name, value);
    const response = await this.fetcher(url.toString(), { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' }, method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Public discovery read failed with status ${response.status}.`);
    const state = await boundedJson(response, stateSchema);
    if (state.state !== 'MISS') return state;
    const claimed = await this.fetcher(new URL('/v2/catalogue/discoveries/claims', this.origin).toString(), {
      body: JSON.stringify({ key, schemaVersion: 1 }), cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (!claimed.ok) throw new Error(`Public discovery claim failed with status ${claimed.status}.`);
    return boundedJson(claimed, stateSchema);
  }

  async resolveOrClaim(input: PublicDiscoveryKey): Promise<PublicDiscoveryClientState> {
    const key = publicDiscoveryKeySchema.parse(input);
    const stored = await this.local.read(key);
    if (stored?.state === 'LEASED' && stored.expiresAt !== undefined && Date.parse(stored.expiresAt) > this.now()) return { expiresAt: stored.expiresAt, state: 'LEASED' };
    if (stored?.state === 'PENDING' && Date.parse(stored.retryAt) > this.now()) return { retryAt: stored.retryAt, state: 'PENDING' };
    const state = await this.requestState(key);
    if (state.state === 'LEASED' && state.leaseToken !== undefined) {
      await this.local.save({ expiresAt: state.expiresAt, id: recordId(key), key, leaseToken: state.leaseToken, retryAt: state.expiresAt, state: 'LEASED' });
      return { expiresAt: state.expiresAt, state: 'LEASED' };
    }
    if (state.state === 'PENDING') await this.local.save({ id: recordId(key), key, retryAt: state.retryAt, state: 'PENDING' });
    return state;
  }

  private async send(record: PublicDiscoveryLocalRecord): Promise<void> {
    if (record.leaseToken === undefined || record.references === undefined) throw new Error('Public discovery proposal requires a persisted lease and references.');
    const response = await this.fetcher(new URL('/v2/catalogue/discoveries/proposals', this.origin).toString(), {
      body: JSON.stringify({ key: record.key, leaseToken: record.leaseToken, references: record.references, schemaVersion: 1 }), cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
    });
    if (response.status === 202) {
      await boundedJson(response, proposalReceiptSchema);
      await this.local.save({ id: record.id, key: record.key, references: record.references, retryAt: new Date(this.now() + 5 * 60_000).toISOString(), state: 'PENDING' });
      return;
    }
    throw new Error(`Public discovery proposal failed with status ${response.status}.`);
  }

  async propose(input: PublicDiscoveryKey, inputReferences: readonly PublicDiscoveryReference[]): Promise<void> {
    const key = publicDiscoveryKeySchema.parse(input);
    const references = publicDiscoveryReferenceSchema.array().min(1).max(5).parse(inputReferences);
    const stored = await this.local.read(key);
    const record: PublicDiscoveryLocalRecord = { id: recordId(key), key, references, retryAt: new Date(this.now()).toISOString(), state: 'PROPOSAL_PENDING' };
    if (stored?.expiresAt !== undefined) record.expiresAt = stored.expiresAt;
    if (stored?.leaseToken !== undefined) record.leaseToken = stored.leaseToken;
    await this.local.save(record);
    if (record.leaseToken !== undefined && record.expiresAt !== undefined && Date.parse(record.expiresAt) > this.now()) await this.send(record);
  }

  async maintain(): Promise<void> {
    const records = await this.local.listProposalPending(20);
    for (const record of records) {
      if (Date.parse(record.retryAt) > this.now() || record.references === undefined) continue;
      try {
        if (record.leaseToken !== undefined && record.expiresAt !== undefined && Date.parse(record.expiresAt) > this.now()) await this.send(record);
        else {
          const state = await this.requestState(record.key);
          if (state.state === 'LEASED' && state.leaseToken !== undefined) await this.send({ ...record, expiresAt: state.expiresAt, leaseToken: state.leaseToken });
          else if (state.state === 'PENDING') await this.local.save({ id: record.id, key: record.key, references: record.references, retryAt: state.retryAt, state: 'PENDING' });
          else if (state.state === 'VERIFIED') await this.local.save({ id: record.id, key: record.key, retryAt: state.verifiedAt, state: 'PENDING' });
        }
      } catch {
        await this.local.save({ ...record, retryAt: new Date(this.now() + 60_000).toISOString(), state: 'PROPOSAL_PENDING' });
      }
    }
  }
}
