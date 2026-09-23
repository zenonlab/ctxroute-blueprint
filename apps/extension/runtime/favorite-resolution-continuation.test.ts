import { MemoryStoragePort } from '@tobirink/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimTask, favoriteResolutionTaskIdentity, importFavoriteSources, isTaskAvailable, preparePublicFavoriteDiscoveryIdentity, runFavoriteResolutionSlice } from '@tobirink/application';
import { HttpPublicDiscoveryAdapter } from '@tobirink/adapters-browser';
import { createFavoriteSource, libraryId, workId } from '@tobirink/domain';
import { createFavoriteProviderRecovery, favoriteProviderRecoveryAlarmName, favoriteProviderRecoveryCursorKey, favoriteProviderRecoveryMaximumAdmissions, favoriteProviderRecoveryMaximumDurationMs, favoriteProviderRecoveryMinimumDelayMs, favoriteResolutionContinuationAlarmName, favoriteResolutionContinuationMinimumDelayMs, favoriteResolutionControlKey, readFavoriteProviderRecoveryCursor, readFavoriteResolutionPaused, restoreFavoriteProviderRecoveryContinuation, restoreFavoriteResolutionContinuation, updateFavoriteResolutionContinuation, writeFavoriteProviderRecoveryCursor, writeFavoriteResolutionPaused } from './favorite-resolution-continuation';
import type { FavoriteProviderRecoveryCursor } from './favorite-resolution-continuation';

async function recoveryFixture(count: number, fetcher: (input: string, init: RequestInit) => Promise<Response>) {
  const storage = new MemoryStoragePort();
  await importFavoriteSources(Array.from({ length: count }, (_, index) => ({ bookmarkId: `recovery-${index}`, folderPath: [], order: index, state: 'eligible' as const, title: `Synthetic Series ${index}`, url: `https://reader.invalid/anime/synthetic-series-${index}` })), storage, new Date().toISOString());
  const sources = await storage.listFavoriteSources({ limit: 100 });
  for (const source of sources) {
    await storage.putFavoriteSource(createFavoriteSource({ ...source, resolution: { kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' } }));
    const task = await storage.getFavoriteResolutionTask(favoriteResolutionTaskIdentity(source.bookmarkId));
    const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();
    if (task !== undefined) await storage.putFavoriteResolutionTask({ ...task, state: 'RETRY_AT', availableAt: retryAt, retryAt });
  }
  let cursor: FavoriteProviderRecoveryCursor | undefined;
  const checkpointStorage = {
    get: async () => ({ [favoriteProviderRecoveryCursorKey]: cursor }),
    set: async (values: { [favoriteProviderRecoveryCursorKey]: FavoriteProviderRecoveryCursor }) => { cursor = structuredClone(values[favoriteProviderRecoveryCursorKey]); },
    remove: async () => { cursor = undefined; },
  };
  let paused = false;
  const scheduled = new Map<string, number>();
  const alarms = {
    create: vi.fn(async (name: string, { when }: { when: number }) => { scheduled.set(name, when); }),
    clear: vi.fn(async (name: string) => scheduled.delete(name)),
    get: async (name: string) => { const scheduledTime = scheduled.get(name); return scheduledTime === undefined ? undefined : { scheduledTime }; },
  };
  const clocks: Record<string, number> = {};
  const clockStorage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
  const client = () => new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, clockStorage);
  const restart = () => createFavoriteProviderRecovery({ alarms, checkpointStorage, client: client(), storage, paused: async () => paused });
  return { alarms, checkpointStorage, client, restart, scheduled, sources, storage, pause: (value: boolean) => { paused = value; } };
}

describe('finite provider recovery with the real HTTP adapter', () => {
  afterEach(() => vi.useRealTimers());
  it('bounds a wake to ten submissions, coalesces callers and resumes after restart without repeats', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async () => { vi.setSystemTime(Date.now() + 1_100); return Response.json({ state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() }); });
    const fixture = await recoveryFixture(12, fetcher);
    const runtime = fixture.restart();
    const first = runtime.run(true);
    expect(runtime.run(true)).toBe(first);
    expect(await first).toBe(10);
    expect(fetcher).toHaveBeenCalledTimes(10);
    expect(await readFavoriteProviderRecoveryCursor(fixture.checkpointStorage)).toMatchObject({ afterId: fixture.sources[9]!.id });
    const resumed = fixture.restart();
    await resumed.restore();
    const next = resumed.run();
    expect(await next).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(await readFavoriteProviderRecoveryCursor(fixture.checkpointStorage)).toBeUndefined();
    expect(await fixture.restart().run()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(12);
  });

  it('restores the saved alarm after a paused wake, resume and browser recreation', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async () => Response.json({ state: 'PENDING', retryAt: '2026-09-23T12:05:00.000Z' }));
    const fixture = await recoveryFixture(1, fetcher);
    await writeFavoriteProviderRecoveryCursor(fixture.checkpointStorage, { retryAt: '2026-09-23T12:02:00.000Z' });
    fixture.pause(true);
    await fixture.restart().restore();
    expect(await fixture.restart().run()).toBe(0);
    expect(fixture.scheduled.size).toBe(0);
    fixture.pause(false);
    const runtime = fixture.restart();
    await runtime.restore();
    expect(fixture.scheduled.get(favoriteProviderRecoveryAlarmName)).toBe(Date.parse('2026-09-23T12:02:00.000Z'));
    expect(await runtime.run()).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
    vi.setSystemTime('2026-09-23T12:02:00.000Z');
    expect(await runtime.run()).toBe(1);
  });

  it('honors a full Retry-After even when manually invoked and recreated before its deadline', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    const fixture = await recoveryFixture(1, fetcher);
    expect(await fixture.restart().run(true)).toBe(0);
    expect(await readFavoriteProviderRecoveryCursor(fixture.checkpointStorage)).toMatchObject({ retryAt: '2026-09-23T12:02:00.000Z' });
    vi.setSystemTime('2026-09-23T12:01:59.999Z');
    expect(await fixture.restart().run(true)).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
    vi.setSystemTime('2026-09-23T12:02:00.000Z');
    expect(await fixture.restart().run()).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not postpone an existing alarm on repeated service-worker starts', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fixture = await recoveryFixture(1, async () => { throw new Error('no HTTP expected'); });
    await writeFavoriteProviderRecoveryCursor(fixture.checkpointStorage, {});
    await fixture.restart().restore();
    vi.setSystemTime('2026-09-23T12:00:20.000Z');
    await fixture.restart().restore();
    expect(fixture.alarms.create).toHaveBeenCalledOnce();
    expect(fixture.scheduled.get(favoriteProviderRecoveryAlarmName)).toBe(Date.parse('2026-09-23T12:00:30.000Z'));
  });

  it('isolates a permanent contract error and hands PENDING to the ordinary durable queue', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    let calls = 0;
    const fetcher = vi.fn(async () => { vi.setSystemTime(Date.now() + 1_100); return ++calls === 1 ? new Response('', { status: 409 }) : Response.json({ state: 'PENDING', retryAt: '2026-09-23T12:05:00.000Z' }); });
    const fixture = await recoveryFixture(2, fetcher);
    const pending = fixture.restart().run(true);
    expect(await pending).toBe(1);
    expect((await fixture.storage.getFavoriteSource(fixture.sources[0]!.id))?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'CONTRACT_CONFLICT' });
    expect((await fixture.storage.getFavoriteSource(fixture.sources[1]!.id))?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PUBLIC_DISCOVERY_PENDING' });
    expect(await fixture.storage.getFavoriteResolutionTask(favoriteResolutionTaskIdentity(fixture.sources[1]!.bookmarkId))).toMatchObject({ state: 'RETRY_AT', availableAt: '2026-09-23T12:05:00.000Z' });
    expect(await readFavoriteProviderRecoveryCursor(fixture.checkpointStorage)).toBeUndefined();
  });

  it('reads an interrupted submission instead of rearming persistent UNAVAILABLE again', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const key = JSON.parse(String(init.body)).keys[0];
      return Response.json([{ key, state: { state: 'UNAVAILABLE', reason: 'ATTEMPT_LIMIT' } }]);
    });
    const fixture = await recoveryFixture(1, fetcher);
    await writeFavoriteProviderRecoveryCursor(fixture.checkpointStorage, { pendingSourceId: fixture.sources[0]!.id, retryAt: '2026-09-23T11:59:00.000Z' });
    expect(await fixture.restart().run()).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![0]).toMatch(/\/lookup$/u);
    expect((await fixture.storage.getFavoriteSource(fixture.sources[0]!.id))?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
    expect(await fixture.restart().run()).toBe(0);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('stops after its 15-second wake budget and saves each response before the next submission', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async () => {
      vi.setSystemTime(Date.now() + 15_000);
      return Response.json({ state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() });
    });
    const fixture = await recoveryFixture(2, fetcher);
    expect(await fixture.restart().run(true)).toBe(1);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(await readFavoriteProviderRecoveryCursor(fixture.checkpointStorage)).toEqual({ afterId: fixture.sources[0]!.id, version: 1 });
  });

  it('uses the same canonical exact-reference payload as a normal lookup', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async (_input: string, _init: RequestInit) => Response.json({ state: 'PENDING', retryAt: '2026-09-23T12:05:00.000Z' }));
    const fixture = await recoveryFixture(1, fetcher);
    const source = fixture.sources[0]!;
    const record = (await fixture.storage.getFavoriteParseArtifact(source.id))!;
    const reference = { provider: 'anilist' as const, externalId: '123' };
    const artifact = { ...record.artifact, sourceEvidence: { ...record.artifact.sourceEvidence, explicitProviderReference: reference } };
    await fixture.storage.putFavoriteParseArtifact({ ...record, artifact });
    const expected = await preparePublicFavoriteDiscoveryIdentity(artifact);
    expect(await fixture.restart().run(true)).toBe(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1].body))).toMatchObject({ key: expected.key, query: { explicitProviderReference: reference } });
  });

  it('converges recovery PENDING to a real Library commit through the restarted ordinary runner', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    let verified = false;
    const fetcher = vi.fn(async () => Response.json(verified ? {
      state: 'VERIFIED', verifiedAt: '2026-09-23T12:04:00.000Z', nextRefreshAt: '2026-09-24T12:04:00.000Z',
      profile: { workId: 'work_recovered', references: [{ provider: 'anilist', externalId: '123' }], candidate: { provider: 'anilist', externalId: '123', mediaKind: 'ANIME', preSerialization: false, titles: ['Synthetic Series'] } },
    } : { state: 'PENDING', retryAt: '2026-09-23T12:05:00.000Z' }));
    const fixture = await recoveryFixture(1, fetcher);
    expect(await fixture.restart().run(true)).toBe(1);
    verified = true;
    vi.setSystemTime('2026-09-23T12:05:00.000Z');
    const taskId = favoriteResolutionTaskIdentity(fixture.sources[0]!.bookmarkId);
    const provider = { search: async () => { throw new Error('provider must stay Worker-only'); }, hydrate: async () => { throw new Error('provider must stay Worker-only'); } };
    const ports = { anilist: provider, mangaupdates: provider, mangadex: provider, 'kitsu-anime': provider, 'kitsu-manga': provider };
    const result = await runFavoriteResolutionSlice({
      publicDiscovery: fixture.client(), storage: fixture.storage, libraryId: libraryId('library_primary'), now: () => new Date().toISOString(), token: () => 'recovery-resumed', candidates: ports, hydration: ports,
      outbox: {
        claimNext: async (input) => {
          const task = await fixture.storage.getFavoriteResolutionTask(taskId);
          if (task === undefined || !isTaskAvailable(task, input.claimedAt)) return undefined;
          const claimed = claimTask(task, input.claimToken, input.claimedAt, input.claimExpiresAt);
          await fixture.storage.putFavoriteResolutionTask(claimed);
          return claimed;
        },
        nextAvailableAt: async () => undefined, block: vi.fn(), retry: vi.fn(),
      },
    });
    expect(result).toMatchObject({ completed: 1, blocked: 0, retried: 0 });
    expect((await fixture.storage.getFavoriteSource(fixture.sources[0]!.id))?.resolution).toEqual({ kind: 'RESOLVED' });
    expect((await fixture.storage.getLibrary(libraryId('library_primary')))?.workIds).toContain(workId('work_recovered'));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('favorite resolution continuation', () => {
  it('tracks the exact durable deadline with the supported 30-second floor and clears an empty queue', async () => {
    const create = vi.fn(async () => undefined);
    const clear = vi.fn(async () => true);
    const now = Date.parse('2026-09-12T12:00:00.000Z');
    await updateFavoriteResolutionContinuation({ clear, create }, '2026-09-12T12:00:00.000Z', () => now);
    expect(create).toHaveBeenCalledWith(favoriteResolutionContinuationAlarmName, { when: now + favoriteResolutionContinuationMinimumDelayMs });
    await updateFavoriteResolutionContinuation({ clear, create }, '2026-09-12T12:05:00.000Z', () => now);
    expect(create).toHaveBeenLastCalledWith(favoriteResolutionContinuationAlarmName, { when: Date.parse('2026-09-12T12:05:00.000Z') });
    await updateFavoriteResolutionContinuation({ clear, create }, undefined, () => now);
    expect(clear).toHaveBeenCalledWith(favoriteResolutionContinuationAlarmName);
    expect(favoriteResolutionContinuationMinimumDelayMs).toBe(30_000);
  });

  it('restores an interrupted inventory before consulting the provider deadline', async () => {
    const storage = new MemoryStoragePort();
    await storage.putFavoriteInventoryCheckpoint({ id: 'favorite-inventory', phase: 'presence', sessionId: 'resume-session', startedAt: '2026-09-12T12:00:00.000Z', status: 'active' });
    const create = vi.fn(async () => undefined);
    const nextAvailableAt = vi.fn(async () => '2026-09-12T13:00:00.000Z');
    const now = Date.parse('2026-09-12T12:05:00.000Z');

    await expect(restoreFavoriteResolutionContinuation({ clear: vi.fn(), create }, storage, { nextAvailableAt }, () => now)).resolves.toBe('2026-09-12T12:05:00.000Z');
    expect(nextAvailableAt).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(favoriteResolutionContinuationAlarmName, { when: now + favoriteResolutionContinuationMinimumDelayMs });

    await storage.putFavoriteInventoryCheckpoint({ id: 'favorite-inventory', sessionId: 'resume-session', startedAt: '2026-09-12T12:00:00.000Z', status: 'complete' });
    await expect(restoreFavoriteResolutionContinuation({ clear: vi.fn(), create }, storage, { nextAvailableAt }, () => now)).resolves.toBe('2026-09-12T13:00:00.000Z');
    expect(nextAvailableAt).toHaveBeenCalledOnce();
  });

  it('persists pause as a strict extension-local controller value', async () => {
    let value: { paused: boolean; version: 1 } | undefined;
    const storage = {
      get: async () => ({ [favoriteResolutionControlKey]: value }),
      set: async (next: { [favoriteResolutionControlKey]: { paused: boolean; version: 1 } }) => { value = next[favoriteResolutionControlKey]; },
    };
    await expect(readFavoriteResolutionPaused(storage)).resolves.toBe(false);
    await writeFavoriteResolutionPaused(storage, true);
    await expect(readFavoriteResolutionPaused(storage)).resolves.toBe(true);
    await writeFavoriteResolutionPaused(storage, false);
    await expect(readFavoriteResolutionPaused(storage)).resolves.toBe(false);
  });

  it('persists and clears the provider recovery cursor', async () => {
    let value: { afterId?: string; retryAt?: string; version: 1 } | undefined;
    const storage = {
      get: async () => ({ [favoriteProviderRecoveryCursorKey]: value }),
      set: async (next: { [favoriteProviderRecoveryCursorKey]: typeof value }) => { value = next[favoriteProviderRecoveryCursorKey]; },
      remove: async () => { value = undefined; },
    };
    await expect(readFavoriteProviderRecoveryCursor(storage)).resolves.toBeUndefined();
    await writeFavoriteProviderRecoveryCursor(storage, { afterId: 'source-20', retryAt: '2026-09-12T12:05:00.000Z' });
    await expect(readFavoriteProviderRecoveryCursor(storage)).resolves.toEqual({ afterId: 'source-20', retryAt: '2026-09-12T12:05:00.000Z', version: 1 });
    await writeFavoriteProviderRecoveryCursor(storage, undefined);
    await expect(readFavoriteProviderRecoveryCursor(storage)).resolves.toBeUndefined();
    expect(favoriteProviderRecoveryMinimumDelayMs).toBe(30_000);
    expect(favoriteProviderRecoveryMaximumDurationMs).toBe(15_000);
    expect(favoriteProviderRecoveryMaximumAdmissions).toBe(10);
  });

  it('restores the persisted provider-recovery alarm after service-worker startup', async () => {
    const now = Date.parse('2026-09-12T12:00:00.000Z');
    const create = vi.fn(async () => undefined);
    const storage = { get: async () => ({ [favoriteProviderRecoveryCursorKey]: { afterId: 'source-20', retryAt: '2026-09-12T12:05:00.000Z', version: 1 as const } }), set: vi.fn(), remove: vi.fn() };
    await restoreFavoriteProviderRecoveryContinuation({ clear: vi.fn(), create }, storage, () => now);
    expect(create).toHaveBeenCalledWith(favoriteProviderRecoveryAlarmName, { when: Date.parse('2026-09-12T12:05:00.000Z') });
  });
});
