import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import { D1AgendaCollectionAdapter } from './public-release-collectors';
import { processAgendaQueue } from '../native-collectors';

const now = '2026-09-20T03:23:00.000Z';
const input = {
  collectionId: 'publication-recovery', provider: 'anilist' as const,
  scheduledFor: now, now, leaseUntil: '2026-09-20T03:38:00.000Z',
  tokenDigest: 'a'.repeat(64), window: { from: '2026-09-19', to: '2026-10-05' },
};
const checkpoint = {
  complete: true, page: 1, provider: 'anilist' as const, received: 1, skippedUnidentified: 0,
  events: [{
    id: 'recovery-release', provider: 'anilist' as const, providerWorkId: 'recovery-provider',
    releaseKind: 'episode' as const, sequence: '1', state: 'SCHEDULED' as const,
    occurrence: { kind: 'DATE' as const, value: '2026-09-21' }, expiresAt: '2026-10-20T00:00:00.000Z',
    provenance: { source: 'anilist', fetchedAt: now, parserVersion: '2', rulesVersion: '2' },
  }],
};

describe('Agenda publication interruption recovery', () => {
  let fixtureIndex = 0;
  let workId: string;
  let providerWorkId: string;
  beforeEach(async () => {
    fixtureIndex += 1;
    workId = `work_recovery_${fixtureIndex}`;
    providerWorkId = `recovery-provider-${fixtureIndex}`;
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare('INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (1234567, ?1)').bind(now),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES (?1, 'anime', 'Recovery', 1234567)").bind(workId),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES ('anilist', ?1, ?2)").bind(providerWorkId, workId),
    ]);
  });

  async function ready(store: R2AgendaOperationStore, adapter: D1AgendaCollectionAdapter) {
    const claim = await adapter.claimLane(input);
    if (claim.status !== 'claimed') throw new Error('Expected collection claim.');
    await adapter.savePage(claim.claim, { ...checkpoint, events: checkpoint.events.map(event => ({ ...event, providerWorkId })) }, now);
    await adapter.completeLane({ claim: claim.claim, provider: 'anilist', scheduledFor: now, checkedAt: now });
    expect(await store.readLane('anilist')).toMatchObject({ publication: 'ready', completedFor: null, activeSnapshotId: null });
  }

  it('replays the ready snapshot after D1 failure without another collection', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'recovery/d1-failure');
    const batch = vi.fn((statements: readonly D1PreparedStatement[]) => env.PUBLIC_DB.batch([...statements]));
    const adapter = new D1AgendaCollectionAdapter({ prepare: query => env.PUBLIC_DB.prepare(query), batch }, store);
    await ready(store, adapter);
    batch.mockRejectedValueOnce(new Error('d1-unavailable'));
    await expect(adapter.publishMergedGeneration(now)).rejects.toThrow('d1-unavailable');
    await expect(adapter.claimLane(input)).resolves.toEqual({ status: 'ready' });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_release_model WHERE work_id = ?1').bind(workId).first()).toEqual({ count: 0 });
    await expect(adapter.publishMergedGeneration(now)).resolves.toMatchObject({ changed: true, count: 1 });
    expect(await store.readLane('anilist')).toMatchObject({ publication: 'published', completedFor: now, activeSnapshotId: input.collectionId });
  });

  it('finishes R2 confirmation without rewriting D1 business data after the D1 commit', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'recovery/confirmation');
    const batch = vi.fn((statements: readonly D1PreparedStatement[]) => env.PUBLIC_DB.batch([...statements]));
    const adapter = new D1AgendaCollectionAdapter({ prepare: query => env.PUBLIC_DB.prepare(query), batch }, store);
    await ready(store, adapter);
    vi.spyOn(store, 'confirmPublication').mockRejectedValueOnce(new Error('r2-confirmation-unavailable'));
    await expect(adapter.publishMergedGeneration(now)).rejects.toThrow('r2-confirmation-unavailable');
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_release_model WHERE work_id = ?1').bind(workId).first()).toEqual({ count: 1 });
    batch.mockClear();
    await expect(adapter.publishMergedGeneration(now)).resolves.toMatchObject({ changed: false, count: 1 });
    expect(batch).not.toHaveBeenCalled();
    expect(await store.readLane('anilist')).toMatchObject({ publication: 'published', completedFor: now });
  });

  it('reenters the real consumer with ready lanes and zero provider requests', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS);
    const adapter = new D1AgendaCollectionAdapter(env.PUBLIC_DB, store);
    await ready(store, adapter);
    const manga = await adapter.claimLane({ ...input, provider: 'mangaupdates', collectionId: 'empty-manga' });
    if (manga.status !== 'claimed') throw new Error('Expected manga claim.');
    await adapter.savePage(manga.claim, { complete: true, events: [], page: 1, provider: 'mangaupdates', received: 0, skippedUnidentified: 0 }, now);
    await adapter.completeLane({ claim: manga.claim, provider: 'mangaupdates', scheduledFor: now, checkedAt: now });
    await expect(processAgendaQueue(env, now)).resolves.toMatchObject({ count: 1, metrics: { providerRequests: 0 } });
    await expect(processAgendaQueue(env, now)).resolves.toMatchObject({ changed: false, metrics: { providerRequests: 0 } });
    expect(await store.readLane('anilist')).toMatchObject({ publication: 'published', completedFor: now });
    expect(await store.readLane('mangaupdates')).toMatchObject({ publication: 'published', completedFor: now });
  });

  it('imports more than twenty old unindexed signals in checkpointed bounded batches', async () => {
    const prefix = 'recovery/legacy-signals';
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, prefix);
    const dates = Array.from({ length: 25 }, (_, index) => new Date(Date.parse(now) + index * 604_800_000).toISOString());
    for (const scheduledFor of dates) {
      await env.RELEASE_SNAPSHOTS.put(`${prefix}/signals/${encodeURIComponent(scheduledFor)}.json`, JSON.stringify({
        schemaVersion: 1, scheduledFor, ownerToken: 's'.repeat(64), createdAt: now, expiresAt: now, state: 'PENDING',
      }));
    }
    await store.recoverLegacySignals();
    const first = await (await env.RELEASE_SNAPSHOTS.get('recovery/legacy-signals/pending.json'))?.json<{ scheduled: string[] }>();
    expect(first?.scheduled).toHaveLength(20);
    await store.recoverLegacySignals();
    const second = await (await env.RELEASE_SNAPSHOTS.get('recovery/legacy-signals/pending.json'))?.json<{ scheduled: string[] }>();
    expect(second?.scheduled).toEqual(dates);
    await store.recoverLegacySignals();
    await expect(store.pendingSignal()).resolves.toBe(dates[0]);
  });

  it('keeps a Queue retry until both live leases expire instead of acknowledging occupied lanes', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS);
    const scheduledFor = '2026-09-27T03:23:00.000Z';
    const startedAt = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + 900_000).toISOString();
    for (const provider of ['anilist', 'mangaupdates'] as const) {
      await expect(store.claimLane({ ...input, provider, scheduledFor, now: startedAt, leaseUntil, collectionId: `occupied-${provider}` })).resolves.toMatchObject({ status: 'claimed' });
    }
    await expect(processAgendaQueue(env, scheduledFor)).rejects.toMatchObject({
      name: 'AgendaCollectionRetryError', retryDelaySeconds: expect.any(Number), metrics: { providerRequests: 0, result: 'backoff' },
    });
    expect(await store.readLane('anilist')).toMatchObject({ collectionId: 'occupied-anilist', leaseUntil });
  });
});
