import { bundledFavoriteSiteRules, collectiveDigest, favoriteCollectiveCommandSchema, importFavoriteSources } from '@tobirink/application';
import type { FavoriteCollectiveCommand, FavoriteOwnerLocalState } from '@tobirink/application';
import { HttpFavoriteCollectiveAdapter } from '@tobirink/adapters-browser';
import { MemoryStoragePort } from '@tobirink/contracts';
import { createFavoriteSource, createReview, createWork, reviewId, workId } from '@tobirink/domain';
import { describe, expect, it, vi } from 'vitest';
import { FavoriteOwnerRuntime } from './favorite-owner-runtime';

function fixture() {
  let state: FavoriteOwnerLocalState | undefined;
  let failNext = false;
  const commands: FavoriteCollectiveCommand[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/rules')) return Response.json(bundledFavoriteSiteRules);
    if (url.endsWith('/batches')) {
      const body = String(init.body); const command = favoriteCollectiveCommandSchema.parse(JSON.parse(body));
      commands.push(command);
      if (failNext) { failNext = false; return new Response(null, { status: 503 }); }
      const results = command.operation === 'lookup' ? command.keys.map(({ fingerprint }) => ({ kind: 'MISS', fingerprint })) : [];
      return Response.json({ schemaVersion: 2, nonce: command.nonce, digest: await collectiveDigest(body), receivedAt: 1, results });
    }
    if (failNext) { failNext = false; return new Response(null, { status: 503 }); }
    return Response.json({ accepted: true });
  });
  const local = { read: async () => structuredClone(state), save: async (value: FavoriteOwnerLocalState) => { state = structuredClone(value); } };
  const http = new HttpFavoriteCollectiveAdapter('https://worker.example', fetcher);
  const storage = new MemoryStoragePort();
  return { commands, fail: () => { failNext = true; }, fetcher, local, storage, runtime: () => new FavoriteOwnerRuntime(local, http, storage) };
}

describe('owner background recovery', () => {
  it('refreshes public rules without creating owner credentials', async () => {
    const test = fixture(); const runtime = test.runtime();
    await runtime.refreshRules();
    await runtime.refreshRules();
    expect(runtime.rules).toEqual(bundledFavoriteSiteRules);
    expect(await test.local.read()).toBeUndefined();
    expect(test.fetcher).toHaveBeenCalledTimes(1);
    expect(test.commands).toEqual([]);
  });
  it('keeps newer bundled rules when the owner cache is older and still fresh', async () => {
    const test = fixture();
    await test.runtime().enable();
    const state = await test.local.read();
    if (!state) throw new Error('Missing owner fixture');
    await test.local.save({ ...state, rules: { ...bundledFavoriteSiteRules, version: 1, rules: [] }, rulesReadAt: Date.now() });
    const runtime = test.runtime();
    await runtime.maintain();
    expect(runtime.rules).toEqual(bundledFavoriteSiteRules);
  });

  it('prefetches fifty keys in one batch and reuses the persisted lookup cache', async () => {
    const test = fixture(); await test.runtime().enable();
    await importFavoriteSources(Array.from({ length: 50 }, (_, index) => ({ bookmarkId: `prefetch-${index}`, folderPath: [], order: index, state: 'eligible' as const, title: `Synthetic Series ${index}`, url: `https://reader.example/anime/synthetic-series-${index}` })), test.storage, '2026-09-08T00:00:00.000Z');
    await test.runtime().maintain();
    const command = test.commands[0];
    if (command?.operation !== 'lookup') throw new Error('Expected grouped lookup');
    expect(command.keys).toHaveLength(50);
    expect(await test.runtime().lookup(command.keys)).toHaveLength(50);
    expect(test.commands).toHaveLength(1);
  });
  it('performs no network effect before consent and resumes a consented registration after a restart', async () => {
    const test = fixture(); const runtime = test.runtime();
    await runtime.maintain(); expect(await runtime.status()).toBe('disabled'); expect(test.fetcher).not.toHaveBeenCalled();
    test.fail(); await expect(runtime.enable()).rejects.toThrow('503');
    const registration = (await test.local.read())?.registration;
    expect((await test.local.read())?.status).toBe('pending');
    await test.runtime().maintain();
    expect((await test.local.read())?.registration).toEqual(registration);
    expect(await test.runtime().status()).toBe('enabled');
  });

  it('retries exactly the pending contribution and never transmits raw favorite data', async () => {
    const test = fixture(); await test.runtime().enable();
    await importFavoriteSources([{ bookmarkId: 'owner-fixture', folderPath: ['Private synthetic folder'], order: 0, state: 'eligible', title: 'Synthetic Series', url: 'https://reader.example/anime/synthetic-series' }], test.storage, '2026-09-08T00:00:00.000Z');
    const source = (await test.storage.listFavoriteSources({ limit: 1 }))[0];
    if (source === undefined) throw new Error('Missing fixture source');
    const id = workId('work_synthetic_001');
    const candidate = { provider: 'anilist' as const, externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, titles: ['Synthetic Series'] };
    await test.storage.putWork(createWork({ id, mediaKind: 'anime', preferredTitle: 'Synthetic Series', externalReferences: [{ provider: 'anilist', externalId: '1' }], hydration: { candidate, hydratedAt: '2026-09-08T00:00:00.000Z', matcherVersion: '3', favoriteAliasKeys: [], providerTitleKeys: ['synthetic series'] } }));
    await test.storage.putFavoriteSource(createFavoriteSource({ ...source, matchedWorkId: id, resolution: { kind: 'RESOLVED' } }));
    test.fail(); await expect(test.runtime().maintain()).rejects.toThrow('503');
    const pending = (await test.local.read())?.pending;
    expect(pending?.operation).toBe('contribute');
    await test.runtime().maintain();
    expect(test.commands).toEqual([pending, pending]);
    await test.runtime().maintain(); expect(test.commands).toHaveLength(2);
    const payload = JSON.stringify(pending);
    expect(payload).not.toMatch(/Synthetic Series|Private synthetic folder|reader\.example/u);
    expect(payload).toContain('"metadata":{"preSerialization":false}');
    expect(payload).toContain('"confirmed":false');
  });

  it('publishes an owner ambiguity as public provider references only', async () => {
    const test = fixture(); await test.runtime().enable();
    await importFavoriteSources([{ bookmarkId: 'ambiguous-fixture', folderPath: ['Private'], order: 0, state: 'eligible', title: 'Synthetic Series', url: 'https://reader.example/anime/synthetic-series' }], test.storage, '2026-09-08T00:00:00.000Z');
    const source = (await test.storage.listFavoriteSources({ limit: 1 }))[0];
    if (source === undefined) throw new Error('Missing fixture source');
    const review = createReview({ id: reviewId('review_owner_ambiguity'), reason: 'AMBIGUOUS', sourceLabel: source.url, status: 'pending', title: source.title });
    await test.storage.putReview(review);
    await test.storage.putFavoriteSource(createFavoriteSource({ ...source, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, reviewId: review.id }));
    await test.storage.putFavoriteReviewCandidateSet({ reviewId: review.id, candidates: [
      { canonicalUrl: 'https://anilist.co/anime/1', externalId: '1', mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Private title one'] },
      { canonicalUrl: 'https://kitsu.app/anime/2', externalId: '2', mediaKind: 'ANIME', preSerialization: false, provider: 'kitsu-anime', titles: ['Private title two'] },
    ], digest: 'ambiguity-fixture', recordedAt: '2026-09-08T00:00:00.000Z' });
    await test.runtime().maintain();
    const command = test.commands.find((value) => value.operation === 'contribute');
    expect(command).toMatchObject({ operation: 'contribute', choices: [], ambiguities: [{ identities: [{ references: [{ externalId: '1' }] }, { references: [{ externalId: '2' }] }] }] });
    expect(JSON.stringify(command)).not.toMatch(/Private|reader\.example|canonicalUrl|titles/u);
  });

  it('stops lookups immediately on revocation and resumes its persisted nonce', async () => {
    const test = fixture(); await test.runtime().enable(); test.fail();
    await expect(test.runtime().revoke()).rejects.toThrow('503');
    expect(await test.runtime().status()).toBe('revoking');
    await test.runtime().lookup([{ fingerprint: 'a'.repeat(64), mediaKind: 'ANIME', parserVersion: '3', siteRulesVersion: '2' }]);
    expect(test.commands).toHaveLength(1);
    await test.runtime().maintain();
    expect(test.commands[1]).toEqual(test.commands[0]);
    expect(await test.runtime().status()).toBe('revoked');
  });

  it('resumes an explicit pairing with the same installation credential after interruption', async () => {
    const test = fixture(); test.fail();
    await expect(test.runtime().redeem(`00000000-0000-4000-8000-000000000001:${'a'.repeat(64)}`)).rejects.toThrow('503');
    const before = (await test.local.read())?.redemption;
    expect(before?.consent).toBe(true);
    await test.runtime().maintain();
    expect(await test.runtime().status()).toBe('enabled');
    expect((await test.local.read())?.registration.installationId).toBe(before?.installationId);
    expect((await test.local.read())?.redemption).toBeUndefined();
  });
});
