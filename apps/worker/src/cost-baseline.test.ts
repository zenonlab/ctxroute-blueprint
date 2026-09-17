import { applyD1Migrations, env } from 'cloudflare:test';
import { D1ProviderRuntimeControl, D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import type { PublicDiscoveryVerifiedProfile } from '@tobirink/public-discovery';
import { beforeEach, describe, expect, it } from 'vitest';
import { instrumentD1 } from './operational-metrics';
import { D1AgendaCollectionAdapter, type PublicReleasePageCheckpoint } from './releases/public-release-collectors';

// Synthetic fixtures only. These are local engine measurements, not remote billing.
const epoch = Date.parse('2026-09-16T12:00:00.000Z');
const at = (minutes: number) => new Date(epoch + minutes * 60_000).toISOString();
const key = (marker: string) => ({ fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' });
const request = (marker: string) => ({ key: key(marker), query: { discoveryTitles: ['Synthetic Alpha'], sourceTitles: ['Synthetic Alpha'], mediaKind: 'ANIME' as const }, requestDigest: marker.repeat(64), schemaVersion: 3 as const });
const profile = {
  candidate: { displayTitle: 'Synthetic Alpha', titles: ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma', 'Synthetic Delta'], externalId: '910001', provider: 'anilist' as const, mediaKind: 'ANIME' as const, preSerialization: false },
  references: [{ externalId: '910001', provider: 'anilist' as const }], workId: 'work_cost_baseline',
};

function meter() {
  const metrics = instrumentD1(env.PUBLIC_DB);
  const records: { scenario: string; rowsRead: number; rowsWritten: number }[] = [];
  return {
    database: metrics.database,
    records,
    async measure<T>(scenario: string, action: () => Promise<T>) {
      const before = metrics.snapshot();
      const value = await action();
      const after = metrics.snapshot();
      records.push({ scenario, rowsRead: after.rowsRead - before.rowsRead, rowsWritten: after.rowsWritten - before.rowsWritten });
      return value;
    },
    report() { console.info('d1-cost-baseline', JSON.stringify(records)); },
  };
}

beforeEach(async () => applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS));

describe('local D1 cost baseline — no external requests', () => {
  it('measures discovery creation, identical admissions, alias and refreshes', async () => {
    const m = meter();
    const adapter = new D1PublicDiscoveryV3Adapter(m.database);
    const claim = (minute: number) => adapter.claimBatch({ claimToken: 'c'.repeat(48), tokenDigest: 'c'.repeat(64), now: at(minute), leaseUntil: at(minute + 15), limit: 20 });
    const publish = (marker: string, minute: number, selected: PublicDiscoveryVerifiedProfile = profile) => adapter.publishBatch({
      claimToken: 'c'.repeat(48), nonce: crypto.randomUUID(), schemaVersion: 3, verifiedAt: at(minute),
      results: [{ key: key(marker), requestDigest: marker.repeat(64), resolution: { state: 'VERIFIED', profile: selected } }],
    }, 'c'.repeat(64), 'd'.repeat(64), at(minute));

    await m.measure('admit-new', () => adapter.request(request('a'), at(0)));
    await m.measure('confirm-signal', () => adapter.confirmQueueSignal(key('a'), 'a'.repeat(64), at(0)));
    await m.measure('duplicate-pending-100', async () => {
      for (let i = 0; i < 100; i += 1) expect((await adapter.request(request('a'), at(0))).outcome).toBe('existing');
    });
    await m.measure('claim-new', () => claim(0));
    await m.measure('publish-new-four-titles', () => publish('a', 0));
    await m.measure('verified-read-100', async () => {
      for (let i = 0; i < 100; i += 1) expect((await adapter.read(key('a'), at(1))).state).toBe('VERIFIED');
    });
    await m.measure('verified-readMany-one', () => adapter.readMany([key('a')], at(1)));
    await m.measure('duplicate-verified', () => adapter.request(request('a'), at(1)));
    const revisionCountBeforeAlias = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions').first<{ count: number }>();
    const workRevisionBeforeAlias = await env.PUBLIC_DB.prepare('SELECT revision FROM catalogue_works WHERE work_id = ?1').bind(profile.workId).first();
    await m.measure('same-work-new-key', async () => {
      await adapter.request(request('b'), at(2));
      await adapter.confirmQueueSignal(key('b'), 'b'.repeat(64), at(2));
      await claim(2);
      return publish('b', 2);
    });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions').first()).toEqual(revisionCountBeforeAlias);
    expect(await env.PUBLIC_DB.prepare('SELECT revision FROM catalogue_works WHERE work_id = ?1').bind(profile.workId).first()).toEqual(workRevisionBeforeAlias);
    const aliasStorage = await env.PUBLIC_DB.prepare(`SELECT
      COUNT(*) AS profileCopies,
      COUNT(DISTINCT result_json) AS distinctProfiles,
      SUM(length(CAST(result_json AS BLOB))) AS profileBytes
      FROM public_discovery_requests_v3
      WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = ?1`).bind(profile.workId).first();
    expect(aliasStorage).toEqual({ profileBytes: expect.any(Number), profileCopies: 2, distinctProfiles: 1 });
    for (const [label, minute, selected] of [
      ['refresh-identical', 8 * 1440, profile],
      ['refresh-changed', 16 * 1440, { ...profile, candidate: { ...profile.candidate, episodeCount: 24 } }],
    ] as const) {
      await m.measure(label, async () => {
        expect((await adapter.requestRefresh(key('a'), at(minute))).outcome).toBe('created');
        await adapter.confirmQueueSignal(key('a'), 'a'.repeat(64), at(minute));
        await claim(minute);
        return publish('a', minute, selected);
      });
    }
    for (const name of ['duplicate-pending-100', 'verified-read-100', 'verified-readMany-one', 'duplicate-verified']) {
      expect(m.records.find(({ scenario }) => scenario === name)?.rowsWritten).toBe(0);
    }
    expect(m.records.find(({ scenario }) => scenario === 'refresh-identical')?.rowsWritten).toBeGreaterThan(0);
    const stock = await env.PUBLIC_DB.prepare(`SELECT
      (SELECT COUNT(*) FROM catalogue_works WHERE work_id = ?1) AS works,
      (SELECT COUNT(*) FROM catalogue_titles WHERE work_id = ?1) AS titles,
      (SELECT COUNT(*) FROM catalogue_canonical_titles_v1 WHERE work_id = ?1) AS canonical,
      (SELECT COUNT(*) FROM catalogue_external_references WHERE work_id = ?1) AS refs`).bind(profile.workId).first();
    expect(stock).toEqual({ works: 1, titles: 4, canonical: 4, refs: 1 });
    const byteStock = await env.PUBLIC_DB.prepare(`SELECT
      (SELECT TOTAL(length(CAST(preferred_title AS BLOB))) FROM catalogue_works WHERE work_id = ?1) AS workBytes,
      (SELECT TOTAL(length(CAST(title AS BLOB))) FROM catalogue_titles WHERE work_id = ?1) AS titleBytes,
      (SELECT TOTAL(length(CAST(external_id AS BLOB))) FROM catalogue_external_references WHERE work_id = ?1) AS referenceBytes,
      (SELECT COUNT(*) FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = ?1) AS profileCopies,
      (SELECT COUNT(DISTINCT result_json) FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = ?1) AS distinctProfiles,
      (SELECT TOTAL(length(CAST(result_json AS BLOB))) FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = ?1) AS profileBytes`).bind(profile.workId).first();
    expect(byteStock).toMatchObject({ distinctProfiles: 2, profileCopies: 2 });
    for (const value of Object.values(byteStock ?? {})) expect(value).toEqual(expect.any(Number));
    expect(m.records.map(({ rowsWritten }) => rowsWritten)).toEqual([5, 4, 0, 4, 42, 0, 0, 0, 19, 12, 12]);
    console.info('d1-cost-baseline-storage-bytes', JSON.stringify({ afterAlias: aliasStorage, afterCounterChange: byteStock }));
    m.report();
  });

  it('measures eight expired claims and the write hidden in a terminal read', async () => {
    const m = meter();
    const adapter = new D1PublicDiscoveryV3Adapter(m.database);
    await m.measure('failed-admission', () => adapter.request(request('e'), at(0)));
    await m.measure('eight-expired-claims', async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const claimed = await adapter.claimBatch({ claimToken: 'e'.repeat(48), tokenDigest: 'e'.repeat(64), now: at(attempt * 2), leaseUntil: at(attempt * 2 + 1), limit: 20 });
        expect(claimed.requests.find(({ key: k }) => k.fingerprint === key('e').fingerprint)?.attempt).toBe(attempt + 1);
      }
    });
    await m.measure('read-exhausted-transition', async () => expect(await adapter.read(key('e'), at(17))).toMatchObject({ state: 'UNAVAILABLE' }));
    await m.measure('read-exhausted-again', () => adapter.read(key('e'), at(18)));
    expect(m.records.find(({ scenario }) => scenario === 'read-exhausted-transition')?.rowsWritten).toBeGreaterThan(0);
    expect(m.records.find(({ scenario }) => scenario === 'read-exhausted-again')?.rowsWritten).toBe(0);
    m.report();
  });

  it('measures provider control without making an HTTP request', async () => {
    const m = meter();
    const runtime = new D1ProviderRuntimeControl(m.database);
    await m.measure('provider-reserve-success', async () => {
      await runtime.reserve('anilist', epoch, 3000);
      await runtime.recordSuccess('anilist', epoch + 100);
    });
    await m.measure('provider-reserve-failure', async () => {
      await runtime.reserve('anilist', epoch + 5000, 3000);
      await runtime.recordFailure('anilist', epoch + 5100);
    });
    expect(m.records.every(({ rowsWritten }) => rowsWritten > 0)).toBe(true);
    m.report();
  });

  it('measures both agenda lanes, unchanged collection, one-event changes and retention', async () => {
    const m = meter();
    const adapter = new D1AgendaCollectionAdapter(m.database);
    const collect = async (cycle: number, changed: boolean) => {
      const now = at(cycle * 7 * 1440);
      for (const provider of ['anilist', 'mangaupdates'] as const) {
        const count = provider === 'anilist' ? 220 : 359;
        const admission = await adapter.claimLane({ provider, collectionId: `cost-${provider}-${cycle}`, tokenDigest: 'a'.repeat(64), now, leaseUntil: at(cycle * 7 * 1440 + 60), scheduledFor: now, window: { from: '2026-09-15', to: '2026-12-31' } });
        if (admission.status !== 'claimed') throw new Error('Expected fresh synthetic lane.');
        for (let offset = 0; offset < count; offset += 50) {
          const events = Array.from({ length: Math.min(50, count - offset) }, (_, index) => ({
            id: `cost-${provider}-${offset + index}`, provider, providerWorkId: String(offset + index),
            releaseKind: provider === 'anilist' ? 'episode' as const : 'chapter' as const,
            sequence: changed && provider === 'anilist' && offset + index === 0 ? String(cycle) : '1',
            state: 'SCHEDULED' as const, occurrence: { kind: 'DATE' as const, value: '2026-09-20' },
            expiresAt: '2027-01-01T00:00:00.000Z', provenance: { source: provider, fetchedAt: now, parserVersion: '2', rulesVersion: '2' },
          }));
          const complete = offset + events.length === count;
          let checkpoint: PublicReleasePageCheckpoint = { provider, page: offset / 50 + 1, complete, events, received: offset + events.length, skippedUnidentified: 0 };
          if (!complete) checkpoint = { ...checkpoint, nextPage: offset / 50 + 2 };
          await adapter.savePage(admission.claim, checkpoint, now);
        }
        await adapter.completeLane({ provider, claim: admission.claim, scheduledFor: now, checkedAt: now });
      }
      return adapter.publishMergedGeneration(now);
    };
    expect(await m.measure('agenda-first-579-13-pages', () => collect(0, false))).toMatchObject({ changed: true, count: 579 });
    expect(await m.measure('agenda-identical-579-13-pages', () => collect(1, false))).toMatchObject({ changed: false, count: 579 });
    for (let cycle = 2; cycle <= 4; cycle += 1) {
      expect(await m.measure(`agenda-one-change-cycle-${cycle}`, () => collect(cycle, true))).toMatchObject({ changed: true, count: 579 });
    }
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_current_event').first()).toEqual({ count: 579 });
    expect(m.records.find(({ scenario }) => scenario === 'agenda-identical-579-13-pages')?.rowsWritten).toBeGreaterThan(0);
    const pages = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_agenda_page').first();
    expect(pages).toEqual({ count: 13 });
    expect(m.records.map(({ rowsWritten }) => rowsWritten)).toEqual([1798, 70, 76, 76, 77]);
    console.info('d1-cost-baseline-agenda-stock', JSON.stringify(pages));
    m.report();
  });

  it('measures relation admission and repeated publication without provider calls', async () => {
    const m = meter();
    const adapter = new D1PublicDiscoveryV3Adapter(m.database);
    const now = at(0);
    await adapter.request(request('f'), now);
    await adapter.claimBatch({ claimToken: 'f'.repeat(48), tokenDigest: 'f'.repeat(64), now, leaseUntil: at(15), limit: 20 });
    const related: PublicDiscoveryVerifiedProfile = { workId: 'work_cost_relation', references: [{ provider: 'anilist', externalId: '910003' }], candidate: { ...profile.candidate, externalId: '910003', displayTitle: 'Synthetic Relation', titles: ['Synthetic Relation'], relations: [{
      mediaKind: 'MANGA', reference: { externalId: '910002', provider: 'anilist' }, relationType: 'ADAPTATION', titles: ['Synthetic Adaptation'],
    }] } };
    const batch = { claimToken: 'f'.repeat(48), nonce: crypto.randomUUID(), schemaVersion: 3 as const, verifiedAt: now, results: [{ key: key('f'), requestDigest: 'f'.repeat(64), resolution: { state: 'VERIFIED' as const, profile: related } }] };
    const receipt = await m.measure('publish-with-one-relation', () => adapter.publishBatch(batch, 'f'.repeat(64), 'f'.repeat(64), now));
    expect(receipt.followUps).toHaveLength(1);
    const followUp = receipt.followUps?.[0];
    if (!followUp) throw new Error('Expected relation admission.');
    await m.measure('relation-signal-confirm', () => adapter.confirmQueueSignal(followUp.key, followUp.requestDigest, now));
    await m.measure('replay-same-publication', async () => expect(await adapter.publishBatch(batch, 'f'.repeat(64), 'f'.repeat(64), now)).toEqual({ published: 0, replayed: 1 }));
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_work_relations').first()).toEqual({ count: 1 });
    m.report();
  });

  it('measures agenda checkpoint recovery and rejects an incomplete snapshot', async () => {
    const m = meter();
    const adapter = new D1AgendaCollectionAdapter(m.database);
    const input = { collectionId: 'cost-interrupted', provider: 'anilist' as const, scheduledFor: at(0), now: at(0), leaseUntil: at(15), tokenDigest: 'a'.repeat(64), window: { from: '2026-09-15', to: '2026-09-30' } };
    const first = await m.measure('agenda-claim', () => adapter.claimLane(input));
    if (first.status !== 'claimed') throw new Error('Expected first claim.');
    await m.measure('agenda-save-first-page', () => adapter.savePage(first.claim, { provider: 'anilist', page: 1, complete: false, nextPage: 2, events: [], received: 0, skippedUnidentified: 0 }, at(0)));
    await expect(adapter.completeLane({ provider: 'anilist', claim: first.claim, scheduledFor: at(0), checkedAt: at(0) })).rejects.toThrow('agenda-staging-incomplete');
    await m.measure('agenda-fail', () => adapter.failLane({ provider: 'anilist', claim: first.claim, retryAt: at(2), errorCode: 'agenda-anilist-unavailable' }));
    expect(await m.measure('agenda-backoff', () => adapter.claimLane({ ...input, now: at(1) }))).toMatchObject({ status: 'deferred' });
    const resumed = await m.measure('agenda-resume', () => adapter.claimLane({ ...input, collectionId: 'must-not-be-used', now: at(3), leaseUntil: at(18) }));
    expect(resumed).toMatchObject({ status: 'claimed', claim: { collectionId: 'cost-interrupted', nextPage: 2 } });
    if (resumed.status !== 'claimed') throw new Error('Expected resumed claim.');
    await m.measure('agenda-save-final-page', () => adapter.savePage(resumed.claim, { provider: 'anilist', page: 2, complete: true, events: [], received: 0, skippedUnidentified: 0 }, at(3)));
    await m.measure('agenda-complete', () => adapter.completeLane({ provider: 'anilist', claim: resumed.claim, scheduledFor: at(0), checkedAt: at(3) }));
    expect(await m.measure('agenda-duplicate-completed', () => adapter.claimLane({ ...input, now: at(4) }))).toEqual({ status: 'complete' });
    expect(m.records.find(({ scenario }) => scenario === 'agenda-duplicate-completed')?.rowsWritten).toBe(0);
    m.report();
  });
});
