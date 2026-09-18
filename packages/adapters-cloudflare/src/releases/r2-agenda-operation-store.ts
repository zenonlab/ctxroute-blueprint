import { z } from 'zod';
import { publicAgendaPageCheckpointSchema, type PublicAgendaPageCheckpoint } from '@tobirink/public-discovery/agenda';

const observationSchema = z.strictObject({ chapter: z.number().finite().nonnegative(), releasedOn: z.iso.date() });
const observationObjectSchema = z.strictObject({
  schemaVersion: z.literal(1), workId: z.string().min(1).max(128), ownerToken: z.string().min(32).max(256),
  observedAt: z.iso.datetime({ offset: false }), expiresAt: z.iso.datetime({ offset: false }),
  observations: z.array(observationSchema).max(12),
});
const workObjectSchema = z.strictObject({
  schemaVersion: z.literal(1), key: z.string().min(1).max(512), ownerToken: z.string().min(32).max(256),
  createdAt: z.iso.datetime({ offset: false }), expiresAt: z.iso.datetime({ offset: false }).nullable(), payload: publicAgendaPageCheckpointSchema,
});
const providerSchema = z.enum(['anilist', 'mangaupdates']);
const pageReferenceSchema = z.strictObject({ page: z.number().int().positive(), key: z.string().max(512), digest: z.string().length(64) });
const signalObjectSchema = z.strictObject({
  schemaVersion: z.literal(1), scheduledFor: z.iso.datetime({ offset: false }), ownerToken: z.string().min(32).max(256),
  createdAt: z.iso.datetime({ offset: false }), expiresAt: z.iso.datetime({ offset: false }), state: z.literal('PENDING'),
});
const pendingSignalsSchema = z.strictObject({
  schemaVersion: z.literal(1), scheduled: z.array(z.iso.datetime({ offset: false })).max(104),
  nextDeliveryAt: z.iso.datetime({ offset: false }).nullable(),
});
const signalScanSchema = z.strictObject({ cursor: z.string().max(2048).nullable(), complete: z.boolean() });
const laneStateSchema = z.strictObject({
  schemaVersion: z.literal(1), provider: providerSchema,
  activeSnapshotId: z.string().min(1).max(128).nullable(), activeDigest: z.string().length(64).nullable(),
  previousSnapshotIds: z.array(z.string().min(1).max(128)).max(2).default([]),
  completedFor: z.iso.datetime({ offset: false }).nullable(), collectionId: z.string().min(1).max(128).nullable(),
  scheduledFor: z.iso.datetime({ offset: false }).nullable(), windowFrom: z.iso.date().nullable(), windowTo: z.iso.date().nullable(),
  nextPage: z.number().int().positive().max(1024), received: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
  notBefore: z.iso.datetime({ offset: false }).nullable(), ownerToken: z.string().min(32).max(256).nullable(),
  leaseUntil: z.iso.datetime({ offset: false }).nullable(), checkedAt: z.iso.datetime({ offset: false }).nullable(),
  publishedCheckedAt: z.iso.datetime({ offset: false }).nullable().optional(),
  pages: z.array(pageReferenceSchema).max(1024).default([]),
  collectionComplete: z.boolean().default(false),
  publication: z.enum(['collecting', 'ready', 'published']).default('collecting'),
  pendingSnapshotId: z.string().min(1).max(128).nullable().default(null),
  pendingDigest: z.string().length(64).nullable().default(null),
});

interface R2JsonObject { etag?: string; httpEtag?: string; json<T>(): Promise<T> }
interface AgendaOperationBucket {
  get(key: string): Promise<R2JsonObject | null>;
  list?(options: { prefix: string; limit: number; cursor?: string }): Promise<{ objects: readonly { key: string }[]; truncated: boolean; cursor?: string }>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string }; onlyIf: { etagDoesNotMatch: string } | { etagMatches: string } }): Promise<void | null | { etag?: string; httpEtag?: string }>;
}

export type AgendaObservation = z.output<typeof observationSchema>;
export type R2AgendaLaneState = z.output<typeof laneStateSchema>;
export type R2AgendaLaneClaim = { collectionId: string; nextPage: number; received: number; skippedUnidentified: number; tokenDigest: string; collectionComplete?: boolean };
export type R2AgendaLaneAdmission = { status: 'complete' | 'ready' } | { status: 'leased' | 'deferred'; retryAt: string } | { status: 'claimed'; claim: R2AgendaLaneClaim };

function expiresAt(now: string): string {
  return new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
}

function etag(object: R2JsonObject | null): string | undefined {
  return object?.etag ?? object?.httpEtag?.replace(/^"|"$/gu, '');
}

async function pageDigest(payload: PublicAgendaPageCheckpoint): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

export class R2AgendaOperationStore {
  constructor(private readonly bucket: AgendaOperationBucket, private readonly prefix = 'agenda-operations/v2', private readonly clock?: () => string) {}

  private async put(key: string, value: string, options: Parameters<AgendaOperationBucket['put']>[2]): Promise<void> {
    if (await this.bucket.put(key, value, options) === null) throw new Error('agenda-r2-precondition-failed');
  }

  async readObservations(workId: string): Promise<readonly AgendaObservation[]> {
    let object = await this.bucket.get([this.prefix, 'observations', `${encodeURIComponent(workId)}.json`].join('/'));
    if (object === null && this.prefix === 'agenda-operations/v2') object = await this.bucket.get(['agenda-operations/v1', 'observations', `${encodeURIComponent(workId)}.json`].join('/'));
    if (object === null) return [];
    return observationObjectSchema.parse(await object.json<unknown>()).observations;
  }

  async writePendingSignal(input: { scheduledFor: string; ownerToken: string; now: string }): Promise<void> {
    await this.updatePendingSignals(input.scheduledFor, false);
    const current = await this.bucket.get([this.prefix, 'signals', `${encodeURIComponent(input.scheduledFor)}.json`].join('/'));
    const body = signalObjectSchema.parse({ schemaVersion: 1, scheduledFor: input.scheduledFor, ownerToken: input.ownerToken, createdAt: input.now, expiresAt: expiresAt(input.now), state: 'PENDING' });
    const currentEtag = etag(current);
    await this.put([this.prefix, 'signals', `${encodeURIComponent(input.scheduledFor)}.json`].join('/'), JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag },
    });
    const verified = await this.bucket.get([this.prefix, 'signals', `${encodeURIComponent(input.scheduledFor)}.json`].join('/'));
    if (verified === null || signalObjectSchema.parse(await verified.json<unknown>()).ownerToken !== input.ownerToken) throw new Error('agenda-r2-signal-ownership-lost');
  }

  private async updatePendingSignals(scheduledFor: string, completed: boolean): Promise<void> {
    const key = [this.prefix, 'pending.json'].join('/');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const object = await this.bucket.get([this.prefix, 'pending.json'].join('/'));
      const current = object === null ? { schemaVersion: 1 as const, scheduled: [], nextDeliveryAt: null } : pendingSignalsSchema.parse(await object.json<unknown>());
      const scheduled = completed ? current.scheduled.filter(value => value !== scheduledFor) : [...new Set([...current.scheduled, scheduledFor])].sort();
      if (JSON.stringify(scheduled) === JSON.stringify(current.scheduled)) return;
      const next = pendingSignalsSchema.parse({ ...current, scheduled, nextDeliveryAt: null });
      const currentEtag = etag(object);
      const result = await this.bucket.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag } });
      if (result !== null) return;
    }
    throw new Error('agenda-signal-contention');
  }

  async pendingSignal(): Promise<string | undefined> {
    const object = await this.bucket.get([this.prefix, 'pending.json'].join('/'));
    return object === null ? undefined : pendingSignalsSchema.parse(await object.json<unknown>()).scheduled[0];
  }

  async finishSignal(scheduledFor: string): Promise<void> {
    const lanes = await Promise.all((['anilist', 'mangaupdates'] as const).map(provider => this.readLane(provider)));
    if (lanes.some(lane => lane.completedFor === null || lane.completedFor < scheduledFor || lane.publication === 'ready')) return;
    await this.updatePendingSignals(scheduledFor, true);
  }

  async reserveSignalDelivery(now: string): Promise<string | undefined> {
    const object = await this.bucket.get([this.prefix, 'pending.json'].join('/'));
    if (object === null) return undefined;
    const current = pendingSignalsSchema.parse(await object.json<unknown>());
    if (current.scheduled.length === 0 || (current.nextDeliveryAt !== null && current.nextDeliveryAt > now)) return undefined;
    const result = await this.bucket.put([this.prefix, 'pending.json'].join('/'), JSON.stringify({ ...current, nextDeliveryAt: new Date(Date.parse(now) + 60_000).toISOString() }), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! },
    });
    return result === null ? undefined : current.scheduled[0];
  }

  async recoverLegacySignals(): Promise<void> {
    if (this.bucket.list === undefined) return;
    const scan = await this.bucket.get([this.prefix, 'legacy-signals-scan.json'].join('/'));
    const checkpoint = scan === null ? { cursor: null, complete: false } : signalScanSchema.parse(await scan.json<unknown>());
    if (checkpoint.complete) return;
    const sourcePrefix = this.prefix === 'agenda-operations/v2' ? 'agenda-operations/v1' : this.prefix;
    const options: Parameters<NonNullable<AgendaOperationBucket['list']>>[0] = { prefix: [sourcePrefix, 'signals', ''].join('/'), limit: 20 };
    if (checkpoint.cursor !== null) options.cursor = checkpoint.cursor;
    const listed = await this.bucket.list(options);
    const lanes = await Promise.all((['anilist', 'mangaupdates'] as const).map(provider => this.readLane(provider)));
    for (const item of listed.objects) {
      const object = await this.bucket.get(item.key);
      if (object === null) continue;
      const signal = signalObjectSchema.parse(await object.json<unknown>());
      if (lanes.some(lane => lane.completedFor === null || lane.completedFor < signal.scheduledFor || lane.publication === 'ready')) await this.updatePendingSignals(signal.scheduledFor, false);
    }
    const currentEtag = etag(scan);
    await this.put([this.prefix, 'legacy-signals-scan.json'].join('/'), JSON.stringify({ cursor: listed.cursor ?? null, complete: !listed.truncated }), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag },
    });
  }

  async readLane(provider: 'anilist' | 'mangaupdates'): Promise<R2AgendaLaneState> {
    let object = await this.bucket.get([this.prefix, 'lanes', `${provider}.json`].join('/'));
    if (object === null && this.prefix === 'agenda-operations/v2') object = await this.bucket.get(['agenda-operations/v1', 'lanes', `${provider}.json`].join('/'));
    if (object !== null) return laneStateSchema.parse(await object.json<unknown>());
    return laneStateSchema.parse({ schemaVersion: 1, provider, activeSnapshotId: null, activeDigest: null, completedFor: null, collectionId: null, scheduledFor: null, windowFrom: null, windowTo: null, nextPage: 1, received: 0, skipped: 0, notBefore: null, ownerToken: null, leaseUntil: null, checkedAt: null });
  }

  async claimLane(input: { provider: 'anilist' | 'mangaupdates'; scheduledFor: string; window: { from: string; to: string }; now: string; leaseUntil: string; tokenDigest: string; collectionId: string }): Promise<R2AgendaLaneAdmission> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const currentObject = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    const current = currentObject === null ? await this.readLane(input.provider) : laneStateSchema.parse(await currentObject.json<unknown>());
    if (current.publication === 'ready') return { status: 'ready' };
    if (current.completedFor !== null && current.completedFor >= input.scheduledFor) {
      if (current.publication === 'collecting' && current.collectionId === null && current.activeSnapshotId !== null && current.activeDigest !== null) {
        const currentEtag = etag(currentObject);
        await this.put(objectKey, JSON.stringify({ ...current, publication: 'ready', pendingSnapshotId: current.activeSnapshotId, pendingDigest: current.activeDigest }), { httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag } });
        return { status: 'ready' };
      }
      return { status: 'complete' };
    }
    if (current.scheduledFor === input.scheduledFor && current.notBefore !== null && current.notBefore > input.now) return { status: 'deferred', retryAt: current.notBefore };
    if (current.leaseUntil !== null && current.leaseUntil > input.now) return { status: 'leased', retryAt: current.leaseUntil };
    const resumed = current.scheduledFor === input.scheduledFor && current.collectionId !== null;
    const next = laneStateSchema.parse({ ...current, collectionId: resumed ? current.collectionId : input.collectionId, scheduledFor: input.scheduledFor, windowFrom: input.window.from, windowTo: input.window.to, nextPage: resumed ? current.nextPage : 1, received: resumed ? current.received : 0, skipped: resumed ? current.skipped : 0, pages: resumed ? current.pages : [], collectionComplete: resumed && current.collectionComplete, publication: 'collecting', notBefore: null, ownerToken: input.tokenDigest, leaseUntil: input.leaseUntil });
    const currentEtag = etag(currentObject);
    const written = await this.bucket.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag } });
    if (written === null) return { status: 'deferred', retryAt: new Date(Date.parse(input.now) + 1_000).toISOString() };
    return { status: 'claimed', claim: { collectionId: next.collectionId!, nextPage: next.nextPage, received: next.received, skippedUnidentified: next.skipped, tokenDigest: input.tokenDigest, collectionComplete: next.collectionComplete } };
  }

  async advanceLane(input: { provider: 'anilist' | 'mangaupdates'; collectionId: string; tokenDigest: string; checkpoint: PublicAgendaPageCheckpoint; now: string; pageReference?: z.output<typeof pageReferenceSchema> }): Promise<void> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-lane-lease-lost');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.collectionId !== input.collectionId || current.ownerToken !== input.tokenDigest || current.leaseUntil === null || current.leaseUntil <= (this.clock?.() ?? input.now)) throw new Error('agenda-lane-lease-lost');
    if (current.collectionComplete || input.checkpoint.page !== current.nextPage) throw new Error('agenda-checkpoint-out-of-order');
    if (!input.checkpoint.complete && input.checkpoint.nextPage !== input.checkpoint.page + 1) throw new Error('agenda-checkpoint-page-gap');
    const pages = input.pageReference === undefined ? current.pages : [...current.pages, input.pageReference];
    const next = laneStateSchema.parse({ ...current, pages, collectionComplete: input.checkpoint.complete, nextPage: input.checkpoint.nextPage ?? input.checkpoint.page, received: input.checkpoint.received, skipped: input.checkpoint.skippedUnidentified, notBefore: input.checkpoint.notBefore === undefined ? null : new Date(input.checkpoint.notBefore).toISOString() });
    await this.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! } });
  }

  async failLane(input: { provider: 'anilist' | 'mangaupdates'; collectionId: string; tokenDigest: string; retryAt: string }): Promise<void> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-lane-lease-lost');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.collectionId !== input.collectionId || current.ownerToken !== input.tokenDigest) throw new Error('agenda-lane-lease-lost');
    if (this.clock !== undefined && (current.leaseUntil === null || current.leaseUntil <= this.clock())) throw new Error('agenda-lane-lease-lost');
    const next = laneStateSchema.parse({ ...current, notBefore: input.retryAt, ownerToken: null, leaseUntil: null });
    await this.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! } });
  }

  async completeLane(input: { provider: 'anilist' | 'mangaupdates'; collectionId: string; tokenDigest: string; scheduledFor: string; checkedAt: string; digest: string; changed: boolean }): Promise<void> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-lane-lease-lost');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.collectionId !== input.collectionId || current.ownerToken !== input.tokenDigest || current.leaseUntil === null || current.leaseUntil <= (this.clock?.() ?? input.checkedAt)) throw new Error('agenda-lane-lease-lost');
    const next = laneStateSchema.parse({ ...current, publishedCheckedAt: current.publishedCheckedAt ?? current.checkedAt, publication: 'ready', pendingSnapshotId: input.collectionId, pendingDigest: input.digest, checkedAt: input.checkedAt, collectionId: null, nextPage: 1, received: 0, skipped: 0, notBefore: null, ownerToken: null, leaseUntil: null });
    await this.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! } });
  }

  async confirmPublication(provider: 'anilist' | 'mangaupdates', digest: string, snapshotId: string): Promise<void> {
    const key = [this.prefix, 'lanes', `${provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-publication-missing');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.publication === 'published' && current.activeDigest === digest && current.activeSnapshotId === snapshotId) return;
    if (current.publication !== 'ready' || current.pendingDigest !== digest || current.pendingSnapshotId !== snapshotId) throw new Error('agenda-publication-changed');
    const previousSnapshotIds = current.activeSnapshotId === null ? current.previousSnapshotIds : [...new Set([current.activeSnapshotId, ...current.previousSnapshotIds])].slice(0, 2);
    await this.put(key, JSON.stringify({ ...current, publication: 'published', publishedCheckedAt: current.checkedAt, completedFor: current.scheduledFor, activeSnapshotId: current.pendingSnapshotId, activeDigest: digest, pendingSnapshotId: null, pendingDigest: null, previousSnapshotIds }), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! },
    });
  }

  async saveLanePage(claim: R2AgendaLaneClaim, checkpoint: PublicAgendaPageCheckpoint, now: string): Promise<void> {
    const current = await this.readLane(checkpoint.provider);
    if (current.collectionId !== claim.collectionId || current.ownerToken !== claim.tokenDigest || current.leaseUntil === null || current.leaseUntil <= (this.clock?.() ?? now)) throw new Error('agenda-lane-lease-lost');
    const payload = publicAgendaPageCheckpointSchema.parse(checkpoint);
    const digest = await pageDigest(payload);
    const key = ['pages', checkpoint.provider, claim.collectionId, `${checkpoint.page}-${digest}`].join('/');
    await this.writePageVersion({ key, payload, ownerToken: claim.tokenDigest, now, retention: 'retained' });
    await this.advanceLane({ provider: checkpoint.provider, collectionId: claim.collectionId, tokenDigest: claim.tokenDigest, checkpoint: payload, now, pageReference: { page: checkpoint.page, key, digest } });
  }

  async readLanePages(provider: 'anilist' | 'mangaupdates', collectionId: string): Promise<readonly PublicAgendaPageCheckpoint[]> {
    const state = await this.readLane(provider);
    if (state.collectionId !== collectionId) throw new Error('agenda-lane-lease-lost');
    const pages: PublicAgendaPageCheckpoint[] = [];
    for (let page = 1; page <= state.nextPage; page += 1) {
      const reference = state.pages.find(item => item.page === page);
      const payload = await this.readPageVersion(reference?.key ?? ['pages', provider, collectionId, String(page)].join('/'));
      if (payload === undefined || payload.page !== page || payload.provider !== provider) throw new Error('agenda-staging-page-gap');
      if (reference !== undefined && await pageDigest(payload) !== reference.digest) throw new Error('agenda-page-digest-mismatch');
      pages.push(payload);
    }
    return pages;
  }

  async mergeObservations(input: { workId: string; observations: readonly AgendaObservation[]; ownerToken: string; now: string }): Promise<readonly AgendaObservation[]> {
    const objectKey = [this.prefix, 'observations', `${encodeURIComponent(input.workId)}.json`].join('/');
    const current = await this.bucket.get([this.prefix, 'observations', `${encodeURIComponent(input.workId)}.json`].join('/'));
    let previous: readonly AgendaObservation[] = current === null ? [] : observationObjectSchema.parse(await current.json<unknown>()).observations;
    if (current === null && this.prefix === 'agenda-operations/v2') previous = await this.readObservations(input.workId);
    const merged = [...new Map([...previous, ...input.observations].map((item) => [item.chapter, observationSchema.parse(item)])).values()]
      .sort((left, right) => left.releasedOn.localeCompare(right.releasedOn) || left.chapter - right.chapter).slice(-12);
    if (JSON.stringify(previous) === JSON.stringify(merged)) return previous;
    const body = observationObjectSchema.parse({ schemaVersion: 1, workId: input.workId, ownerToken: input.ownerToken, observedAt: input.now, expiresAt: expiresAt(input.now), observations: merged });
    const currentEtag = etag(current);
    await this.put(objectKey, JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag },
    });
    const verified = await this.bucket.get([this.prefix, 'observations', `${encodeURIComponent(input.workId)}.json`].join('/'));
    if (verified === null) throw new Error('agenda-r2-observations-missing-after-write');
    const parsed = observationObjectSchema.parse(await verified.json<unknown>());
    if (parsed.ownerToken !== input.ownerToken) throw new Error('agenda-r2-observation-ownership-lost');
    return parsed.observations;
  }

  async writePageVersion(input: { key: string; payload: PublicAgendaPageCheckpoint; ownerToken: string; now: string; retention?: 'temporary' | 'retained' }): Promise<void> {
    const safeSegments = input.key.split('/').map((segment) => encodeURIComponent(z.string().min(1).max(128).parse(segment)));
    const objectKey = [this.prefix, 'work', `${safeSegments.join('/')}.json`].join('/');
    const current = await this.bucket.get([this.prefix, 'work', `${safeSegments.join('/')}.json`].join('/'));
    if (current !== null) {
      const stored = workObjectSchema.parse(await current.json<unknown>());
      if (await pageDigest(stored.payload) !== await pageDigest(publicAgendaPageCheckpointSchema.parse(input.payload))) throw new Error('agenda-r2-immutable-conflict');
      return;
    }
    const body = workObjectSchema.parse({
      schemaVersion: 1, key: input.key, ownerToken: input.ownerToken, createdAt: input.now,
      expiresAt: input.retention === 'retained' ? null : expiresAt(input.now), payload: input.payload,
    });
    const currentEtag = etag(current);
    await this.put(objectKey, JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag },
    });
    const verified = await this.bucket.get([this.prefix, 'work', `${safeSegments.join('/')}.json`].join('/'));
    if (verified === null || workObjectSchema.parse(await verified.json<unknown>()).ownerToken !== input.ownerToken) throw new Error('agenda-r2-work-ownership-lost');
  }

  async readPageVersion(key: string, ownerToken?: string): Promise<PublicAgendaPageCheckpoint | undefined> {
    const safeSegments = key.split('/').map((segment) => encodeURIComponent(z.string().min(1).max(128).parse(segment)));
    let object = await this.bucket.get([this.prefix, 'work', `${safeSegments.join('/')}.json`].join('/'));
    if (object === null && this.prefix === 'agenda-operations/v2') object = await this.bucket.get(['agenda-operations/v1', 'work', `${safeSegments.join('/')}.json`].join('/'));
    if (object === null) return undefined;
    const stored = workObjectSchema.parse(await object.json<unknown>());
    if (ownerToken !== undefined && stored.ownerToken !== ownerToken) throw new Error('agenda-r2-work-ownership-lost');
    return stored.payload;
  }
}
