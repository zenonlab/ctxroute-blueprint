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
const signalObjectSchema = z.strictObject({
  schemaVersion: z.literal(1), scheduledFor: z.iso.datetime({ offset: false }), ownerToken: z.string().min(32).max(256),
  createdAt: z.iso.datetime({ offset: false }), expiresAt: z.iso.datetime({ offset: false }), state: z.literal('PENDING'),
});
const laneStateSchema = z.strictObject({
  schemaVersion: z.literal(1), provider: providerSchema,
  activeSnapshotId: z.string().min(1).max(128).nullable(), activeDigest: z.string().length(64).nullable(),
  previousSnapshotIds: z.array(z.string().min(1).max(128)).max(2).default([]),
  completedFor: z.iso.datetime({ offset: false }).nullable(), collectionId: z.string().min(1).max(128).nullable(),
  scheduledFor: z.iso.datetime({ offset: false }).nullable(), windowFrom: z.iso.date().nullable(), windowTo: z.iso.date().nullable(),
  nextPage: z.number().int().positive(), received: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
  notBefore: z.iso.datetime({ offset: false }).nullable(), ownerToken: z.string().min(32).max(256).nullable(),
  leaseUntil: z.iso.datetime({ offset: false }).nullable(), checkedAt: z.iso.datetime({ offset: false }).nullable(),
});

interface R2JsonObject { etag?: string; httpEtag?: string; json<T>(): Promise<T> }
interface AgendaOperationBucket {
  get(key: string): Promise<R2JsonObject | null>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string }; onlyIf: { etagDoesNotMatch: string } | { etagMatches: string } }): Promise<void | { etag?: string; httpEtag?: string }>;
}

export type AgendaObservation = z.output<typeof observationSchema>;
export type R2AgendaLaneState = z.output<typeof laneStateSchema>;
export type R2AgendaLaneClaim = { collectionId: string; nextPage: number; received: number; skippedUnidentified: number; tokenDigest: string };
export type R2AgendaLaneAdmission = { status: 'complete' | 'leased' } | { status: 'deferred'; retryAt: string } | { status: 'claimed'; claim: R2AgendaLaneClaim };

function expiresAt(now: string): string {
  return new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
}

function etag(object: R2JsonObject | null): string | undefined {
  return object?.etag ?? object?.httpEtag?.replace(/^"|"$/gu, '');
}

export class R2AgendaOperationStore {
  constructor(private readonly bucket: AgendaOperationBucket, private readonly prefix = 'agenda-operations/v1') {}

  async readObservations(workId: string): Promise<readonly AgendaObservation[]> {
    const object = await this.bucket.get([this.prefix, 'observations', `${encodeURIComponent(workId)}.json`].join('/'));
    if (object === null) return [];
    return observationObjectSchema.parse(await object.json<unknown>()).observations;
  }

  async writePendingSignal(input: { scheduledFor: string; ownerToken: string; now: string }): Promise<void> {
    const current = await this.bucket.get([this.prefix, 'signals', `${encodeURIComponent(input.scheduledFor)}.json`].join('/'));
    const body = signalObjectSchema.parse({ schemaVersion: 1, scheduledFor: input.scheduledFor, ownerToken: input.ownerToken, createdAt: input.now, expiresAt: expiresAt(input.now), state: 'PENDING' });
    const currentEtag = etag(current);
    await this.bucket.put([this.prefix, 'signals', `${encodeURIComponent(input.scheduledFor)}.json`].join('/'), JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag },
    });
    const verified = await this.bucket.get([this.prefix, 'signals', `${encodeURIComponent(input.scheduledFor)}.json`].join('/'));
    if (verified === null || signalObjectSchema.parse(await verified.json<unknown>()).ownerToken !== input.ownerToken) throw new Error('agenda-r2-signal-ownership-lost');
  }

  async readLane(provider: 'anilist' | 'mangaupdates'): Promise<R2AgendaLaneState> {
    const object = await this.bucket.get([this.prefix, 'lanes', `${provider}.json`].join('/'));
    if (object !== null) return laneStateSchema.parse(await object.json<unknown>());
    return laneStateSchema.parse({ schemaVersion: 1, provider, activeSnapshotId: null, activeDigest: null, completedFor: null, collectionId: null, scheduledFor: null, windowFrom: null, windowTo: null, nextPage: 1, received: 0, skipped: 0, notBefore: null, ownerToken: null, leaseUntil: null, checkedAt: null });
  }

  async claimLane(input: { provider: 'anilist' | 'mangaupdates'; scheduledFor: string; window: { from: string; to: string }; now: string; leaseUntil: string; tokenDigest: string; collectionId: string }): Promise<R2AgendaLaneAdmission> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const currentObject = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    const current = currentObject === null ? await this.readLane(input.provider) : laneStateSchema.parse(await currentObject.json<unknown>());
    if (current.completedFor === input.scheduledFor) return { status: 'complete' };
    if (current.scheduledFor === input.scheduledFor && current.notBefore !== null && current.notBefore > input.now) return { status: 'deferred', retryAt: current.notBefore };
    if (current.leaseUntil !== null && current.leaseUntil > input.now) return { status: 'leased' };
    const resumed = current.scheduledFor === input.scheduledFor && current.collectionId !== null;
    const next = laneStateSchema.parse({ ...current, collectionId: resumed ? current.collectionId : input.collectionId, scheduledFor: input.scheduledFor, windowFrom: input.window.from, windowTo: input.window.to, nextPage: resumed ? current.nextPage : 1, received: resumed ? current.received : 0, skipped: resumed ? current.skipped : 0, notBefore: null, ownerToken: input.tokenDigest, leaseUntil: input.leaseUntil });
    const currentEtag = etag(currentObject);
    try {
      await this.bucket.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag } });
    } catch { return { status: 'leased' }; }
    return { status: 'claimed', claim: { collectionId: next.collectionId!, nextPage: next.nextPage, received: next.received, skippedUnidentified: next.skipped, tokenDigest: input.tokenDigest } };
  }

  async advanceLane(input: { provider: 'anilist' | 'mangaupdates'; collectionId: string; tokenDigest: string; checkpoint: PublicAgendaPageCheckpoint; now: string }): Promise<void> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-lane-lease-lost');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.collectionId !== input.collectionId || current.ownerToken !== input.tokenDigest || current.leaseUntil === null || current.leaseUntil <= input.now) throw new Error('agenda-lane-lease-lost');
    const next = laneStateSchema.parse({ ...current, nextPage: input.checkpoint.nextPage ?? input.checkpoint.page, received: input.checkpoint.received, skipped: input.checkpoint.skippedUnidentified, notBefore: input.checkpoint.notBefore === undefined ? null : new Date(input.checkpoint.notBefore).toISOString() });
    await this.bucket.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! } });
  }

  async failLane(input: { provider: 'anilist' | 'mangaupdates'; collectionId: string; tokenDigest: string; retryAt: string }): Promise<void> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-lane-lease-lost');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.collectionId !== input.collectionId || current.ownerToken !== input.tokenDigest) throw new Error('agenda-lane-lease-lost');
    const next = laneStateSchema.parse({ ...current, notBefore: input.retryAt, ownerToken: null, leaseUntil: null });
    await this.bucket.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! } });
  }

  async completeLane(input: { provider: 'anilist' | 'mangaupdates'; collectionId: string; tokenDigest: string; scheduledFor: string; checkedAt: string; digest: string; changed: boolean }): Promise<void> {
    const objectKey = [this.prefix, 'lanes', `${input.provider}.json`].join('/');
    const object = await this.bucket.get([this.prefix, 'lanes', `${input.provider}.json`].join('/'));
    if (object === null) throw new Error('agenda-lane-lease-lost');
    const current = laneStateSchema.parse(await object.json<unknown>());
    if (current.collectionId !== input.collectionId || current.ownerToken !== input.tokenDigest || current.leaseUntil === null || current.leaseUntil <= input.checkedAt) throw new Error('agenda-lane-lease-lost');
    const previousSnapshotIds = input.changed && current.activeSnapshotId !== null
      ? [...new Set([current.activeSnapshotId, ...current.previousSnapshotIds])].slice(0, 2)
      : current.previousSnapshotIds;
    const next = laneStateSchema.parse({ ...current, activeSnapshotId: input.changed ? input.collectionId : current.activeSnapshotId, activeDigest: input.changed ? input.digest : current.activeDigest, previousSnapshotIds, completedFor: input.scheduledFor, checkedAt: input.checkedAt, collectionId: null, nextPage: 1, received: 0, skipped: 0, notBefore: null, ownerToken: null, leaseUntil: null });
    await this.bucket.put(objectKey, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagMatches: etag(object)! } });
  }

  async mergeObservations(input: { workId: string; observations: readonly AgendaObservation[]; ownerToken: string; now: string }): Promise<readonly AgendaObservation[]> {
    const objectKey = [this.prefix, 'observations', `${encodeURIComponent(input.workId)}.json`].join('/');
    const current = await this.bucket.get([this.prefix, 'observations', `${encodeURIComponent(input.workId)}.json`].join('/'));
    const previous = current === null ? [] : observationObjectSchema.parse(await current.json<unknown>()).observations;
    const merged = [...new Map([...previous, ...input.observations].map((item) => [`${item.chapter}|${item.releasedOn}`, observationSchema.parse(item)])).values()]
      .sort((left, right) => left.releasedOn.localeCompare(right.releasedOn) || left.chapter - right.chapter).slice(-12);
    if (JSON.stringify(previous) === JSON.stringify(merged)) return previous;
    const body = observationObjectSchema.parse({ schemaVersion: 1, workId: input.workId, ownerToken: input.ownerToken, observedAt: input.now, expiresAt: expiresAt(input.now), observations: merged });
    const currentEtag = etag(current);
    await this.bucket.put(objectKey, JSON.stringify(body), {
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
    const body = workObjectSchema.parse({
      schemaVersion: 1, key: input.key, ownerToken: input.ownerToken, createdAt: input.now,
      expiresAt: input.retention === 'retained' ? null : expiresAt(input.now), payload: input.payload,
    });
    const currentEtag = etag(current);
    await this.bucket.put(objectKey, JSON.stringify(body), {
      httpMetadata: { contentType: 'application/json' }, onlyIf: currentEtag === undefined ? { etagDoesNotMatch: '*' } : { etagMatches: currentEtag },
    });
    const verified = await this.bucket.get([this.prefix, 'work', `${safeSegments.join('/')}.json`].join('/'));
    if (verified === null || workObjectSchema.parse(await verified.json<unknown>()).ownerToken !== input.ownerToken) throw new Error('agenda-r2-work-ownership-lost');
  }

  async readPageVersion(key: string, ownerToken?: string): Promise<PublicAgendaPageCheckpoint | undefined> {
    const safeSegments = key.split('/').map((segment) => encodeURIComponent(z.string().min(1).max(128).parse(segment)));
    const object = await this.bucket.get([this.prefix, 'work', `${safeSegments.join('/')}.json`].join('/'));
    if (object === null) return undefined;
    const stored = workObjectSchema.parse(await object.json<unknown>());
    if (ownerToken !== undefined && stored.ownerToken !== ownerToken) throw new Error('agenda-r2-work-ownership-lost');
    return stored.payload;
  }
}
