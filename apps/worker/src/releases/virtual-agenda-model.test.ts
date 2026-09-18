import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';
import { D1AgendaCollectionAdapter } from './public-release-collectors';
import type { PublicReleaseEventContract } from '@tobirink/application';

describe('virtual Agenda model publication', () => {
  it('replaces one announcement on postponement, retains absence, and publishes an explicit cancellation', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare("INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (91919191, '2026-09-01T00:00:00.000Z')"),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_postponed', 'anime', 'Postponed', 91919191)"),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES ('anilist', 'postponed', 'work_postponed')"),
    ]);
    const operations = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'canonical/postponed');
    const writer = new D1AgendaCollectionAdapter(env.PUBLIC_DB, operations);
    const reader = new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB, operations);
    const event: PublicReleaseEventContract = { id: 'announce-old', provider: 'anilist', providerWorkId: 'postponed', releaseKind: 'episode', sequence: '12.5-special', state: 'SCHEDULED', occurrence: { kind: 'DATE', value: '2026-10-01' }, expiresAt: '2026-11-01T00:00:00.000Z', provenance: { source: 'anilist', fetchedAt: '2026-09-01T00:00:00.000Z', parserVersion: '2', rulesVersion: '2' } };
    const publish = async (day: string, events: readonly PublicReleaseEventContract[]) => {
      const now = `2026-09-${day}T00:00:00.000Z`;
      const admitted = await writer.claimLane({ provider: 'anilist', collectionId: `postponed-${day}`, scheduledFor: now, now, leaseUntil: `2026-09-${day}T01:00:00.000Z`, tokenDigest: day.repeat(32), window: { from: '2026-09-01', to: '2026-11-01' } });
      if (admitted.status !== 'claimed') throw new Error('Expected canonical lane.');
      await writer.savePage(admitted.claim, { provider: 'anilist', complete: true, page: 1, received: events.length, skippedUnidentified: 0, events: events.map(value => ({ ...value, provenance: { ...value.provenance, fetchedAt: now } })) }, now);
      await writer.completeLane({ claim: admitted.claim, provider: 'anilist', scheduledFor: now, checkedAt: now });
      return writer.publishMergedGeneration(now);
    };
    await publish('01', [event]);
    const postponed = { ...event, id: 'announce-new', occurrence: { kind: 'DATE' as const, value: '2026-10-08' } };
    await publish('08', [postponed]);
    const query = { from: '2026-10-01', to: '2026-10-20', limit: 100 };
    expect((await reader.query(query)).entries.filter(value => value.providerWorkId === 'postponed')).toMatchObject([{ id: 'announce-new', occurrence: { kind: 'DATE', value: '2026-10-08' }, sequence: '12.5-special' }]);
    await publish('15', []);
    expect((await reader.query(query)).entries.filter(value => value.providerWorkId === 'postponed')).toHaveLength(1);
    await publish('22', [{ ...postponed, state: 'CANCELLED' }]);
    expect((await reader.query(query)).entries.filter(value => value.providerWorkId === 'postponed')).toMatchObject([{ state: 'CANCELLED' }]);
    expect((await reader.queryModels(query)).revision).toBe((await reader.query(query)).revision);
    expect(await operations.readPageVersion('snapshots/anilist/postponed-01')).toMatchObject({ events: [{ id: 'announce-old' }] });
  });

  const laneInput = {
    provider: 'anilist' as const, scheduledFor: '2026-09-20T03:23:00.000Z',
    window: { from: '2026-09-20', to: '2026-10-20' },
    now: '2026-09-20T03:23:00.000Z', leaseUntil: '2026-09-20T03:24:00.000Z',
    tokenDigest: 'a'.repeat(64), collectionId: 'resume-regression',
  };
  const checkpoint = {
    complete: false, events: [], page: 1, nextPage: 2,
    provider: 'anilist' as const, received: 0, skippedUnidentified: 0,
  };

  it('returns null on real R2 precondition failures and leaves the original object intact', async () => {
    const key = 'regressions/conditional.json';
    const first = await env.RELEASE_SNAPSHOTS.put(key, 'original', { onlyIf: { etagDoesNotMatch: '*' } });
    expect(first).not.toBeNull();
    await expect(env.RELEASE_SNAPSHOTS.put(key, 'replacement', { onlyIf: { etagDoesNotMatch: '*' } })).resolves.toBeNull();
    await expect(env.RELEASE_SNAPSHOTS.put(key, 'replacement', { onlyIf: { etagMatches: 'wrong-etag' } })).resolves.toBeNull();
    expect(await (await env.RELEASE_SNAPSHOTS.get(key))?.text()).toBe('original');
  });

  it('grants exactly one concurrent lane claim under real R2 preconditions', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'regressions/concurrent');
    const results = await Promise.all([
      store.claimLane(laneInput),
      store.claimLane({ ...laneInput, tokenDigest: 'b'.repeat(64) }),
    ]);
    expect(results.filter(result => result.status === 'claimed')).toHaveLength(1);
  });

  it('assembles validated pages written under an earlier lease after resume', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'regressions/resume');
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB, store);
    const first = await state.claimLane(laneInput);
    if (first.status !== 'claimed') throw new Error('Expected initial claim.');
    await state.savePage(first.claim, checkpoint, laneInput.now);
    const resumed = await state.claimLane({ ...laneInput, now: laneInput.leaseUntil, leaseUntil: '2026-09-20T03:25:00.000Z', tokenDigest: 'b'.repeat(64) });
    if (resumed.status !== 'claimed') throw new Error('Expected resumed claim.');
    expect(resumed.claim).toMatchObject({ collectionId: first.claim.collectionId, nextPage: 2 });
    await state.savePage(resumed.claim, { complete: true, events: [], page: 2, provider: 'anilist', received: 0, skippedUnidentified: 0 }, laneInput.leaseUntil);
    await expect(state.completeLane({ checkedAt: laneInput.leaseUntil, claim: resumed.claim, provider: 'anilist', scheduledFor: laneInput.scheduledFor }))
      .resolves.toMatchObject({ events: [] });
  });

  it('does not overwrite an accepted page when a stale owner attempts another save', async () => {
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'regressions/stale-page');
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB, store);
    const first = await state.claimLane(laneInput);
    if (first.status !== 'claimed') throw new Error('Expected initial claim.');
    await state.savePage(first.claim, checkpoint, laneInput.now);
    const accepted = (await store.readLane('anilist')).pages[0]!;
    await state.claimLane({ ...laneInput, now: laneInput.leaseUntil, leaseUntil: '2026-09-20T03:25:00.000Z', tokenDigest: 'b'.repeat(64) });
    await expect(state.savePage(first.claim, { ...checkpoint, received: 999 }, laneInput.leaseUntil)).rejects.toThrow();
    expect(await store.readPageVersion(accepted.key)).toEqual(checkpoint);
  });

  it('stores complete multi-page checkpoints in R2 before completing the D1 pointer', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB, new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS));
    const now = '2026-09-17T03:23:00.000Z';
    const admission = await state.claimLane({
      collectionId: 'r2-pages', leaseUntil: '2026-09-17T04:23:00.000Z', now,
      provider: 'mangaupdates', scheduledFor: now, tokenDigest: 'r'.repeat(64),
      window: { from: '2026-09-15', to: '2026-10-01' },
    });
    if (admission.status !== 'claimed') throw new Error('Expected claimed R2 Agenda lane.');
    const event = (id: string, sequence: string) => ({
      expiresAt: '2026-11-20T00:00:00.000Z', id, occurrence: { kind: 'DATE' as const, value: '2026-09-16' },
      provenance: { fetchedAt: now, parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates' as const, providerWorkId: 'r2-work', releaseKind: 'chapter' as const, sequence, state: 'CONFIRMED' as const,
    });
    await state.savePage(admission.claim, { complete: false, events: [event('r2-1', '1')], nextPage: 2, page: 1, provider: 'mangaupdates', received: 1, skippedUnidentified: 0 }, now);
    await state.savePage(admission.claim, { complete: true, events: [event('r2-2', '2')], page: 2, provider: 'mangaupdates', received: 2, skippedUnidentified: 0 }, now);
    await expect(state.completeLane({ checkedAt: now, claim: admission.claim, provider: 'mangaupdates', scheduledFor: now })).resolves.toMatchObject({ events: [{ id: 'r2-1' }, { id: 'r2-2' }] });
    expect(await env.PUBLIC_DB.prepare("SELECT COUNT(*) AS count FROM public_release_agenda_page WHERE collection_id = 'r2-pages'").first()).toEqual({ count: 0 });
  });

  it('publishes one model for a canonical work and writes nothing on an unchanged announcement', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_revisions(revision, published_at) VALUES (5151515151, '2026-09-17T00:00:00.000Z')"),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_known_agenda', 'anime', 'Known Agenda', 5151515151)"),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_stale_agenda', 'anime', 'Stale Agenda', 5151515151)"),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES ('anilist', 'known-1', 'work_known_agenda')"),
      env.PUBLIC_DB.prepare(`INSERT INTO catalogue_release_model(
        work_id, provider, provider_work_id, release_kind, anchor_date, anchor_sequence,
        interval_days, explicit_next_json, exceptions_json, valid_from, valid_to,
        editorial_status, source, observed_at, parser_version, rules_version, model_digest, revision)
        VALUES ('work_stale_agenda', 'anilist', 'stale-1', 'episode', '2026-09-01', '1',
          NULL, '{"id":"stale"}', '[{"id":"stale"}]', '2026-09-01', '2026-09-16',
          'ONGOING', 'anilist', '2026-09-01T00:00:00.000Z', '2', '2', ?1, 5151515151)`)
        .bind('s'.repeat(64)),
    ]);
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB, new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS));
    const event = (fetchedAt: string) => ({
      expiresAt: '2026-11-20T00:00:00.000Z', id: 'known-release-1',
      occurrence: { kind: 'INSTANT' as const, value: '2026-09-20T12:00:00.000Z' },
      provenance: { fetchedAt, parserVersion: '2', rulesVersion: '2', source: 'anilist' },
      provider: 'anilist' as const, providerWorkId: 'known-1', releaseKind: 'episode' as const,
      sequence: '1', state: 'SCHEDULED' as const,
    });
    const run = async (collectionId: string, checkedAt: string) => {
      const admission = await state.claimLane({
        collectionId, leaseUntil: new Date(Date.parse(checkedAt) + 3_600_000).toISOString(), now: checkedAt,
        provider: 'anilist', scheduledFor: checkedAt, tokenDigest: collectionId.padEnd(64, '0'),
        window: { from: '2026-09-15', to: '2026-10-01' },
      });
      if (admission.status !== 'claimed') throw new Error('Expected claimed Agenda lane.');
      await state.savePage(admission.claim, { complete: true, events: [event(checkedAt)], page: 1, provider: 'anilist', received: 1, skippedUnidentified: 0 }, checkedAt);
      await state.completeLane({ checkedAt, claim: admission.claim, provider: 'anilist', scheduledFor: checkedAt });
      return state.publishMergedGeneration(checkedAt);
    };
    const beforeGenerations = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_generation').first<{ count: number }>();
    const first = await run('known-a', '2026-09-17T03:23:00.000Z');
    expect(first).toMatchObject({ changed: true, revision: expect.stringMatching(/^models-\d+-1$/u) });
    expect(await env.PUBLIC_DB.prepare("SELECT explicit_next_json AS explicitNext, exceptions_json AS exceptions FROM catalogue_release_model WHERE work_id = 'work_stale_agenda'").first())
      .toEqual({ exceptions: '[{"id":"stale"}]', explicitNext: '{"id":"stale"}' });
    const firstModel = await env.PUBLIC_DB.prepare("SELECT model_digest AS modelDigest, observed_at AS observedAt FROM catalogue_release_model WHERE work_id = 'work_known_agenda'").first();
    await expect(new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB).queryModels({ from: '2026-09-15', limit: 100, to: '2026-10-01' }))
      .rejects.toThrow();
    await expect(new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB).queryModels({ from: '2026-09-17', limit: 100, to: '2026-10-01' }))
      .resolves.toMatchObject({ models: expect.arrayContaining([expect.objectContaining({ workId: 'work_known_agenda' })]), revision: expect.stringMatching(/^models-[a-f0-9]{48}$/u) });
    const second = await run('known-b', '2026-09-24T03:23:00.000Z');
    expect(second).toMatchObject({ changed: false, revision: first?.revision });
    expect(await env.PUBLIC_DB.prepare("SELECT model_digest AS modelDigest, observed_at AS observedAt FROM catalogue_release_model WHERE work_id = 'work_known_agenda'").first()).toEqual(firstModel);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_generation').first()).toEqual(beforeGenerations);
  });

  it('reuses twelve-bounded manga history for one estimate and advances only confirmed evidence', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const revision = 6161616161;
    const profile = JSON.stringify({ candidate: { externalId: 'known-manga', mediaKind: 'MANGA', preSerialization: false, provider: 'mangaupdates', titles: ['Known Manga'] }, references: [{ externalId: 'known-manga', provider: 'mangaupdates' }], workId: 'work_known_manga' });
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_revisions(revision, published_at) VALUES (?1, '2026-09-23T00:00:00.000Z')").bind(revision),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_known_manga', 'manga', 'Known Manga', ?1)").bind(revision),
      env.PUBLIC_DB.prepare("INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES ('mangaupdates', 'known-manga', 'work_known_manga')"),
      env.PUBLIC_DB.prepare(`INSERT INTO catalogue_current_metadata(
        work_id, profile_json, source_provider, source_external_id, value_observed_at, normalization_version, revision)
        VALUES ('work_known_manga', ?1, 'mangaupdates', 'known-manga', '2026-09-23T00:00:00.000Z', 2, ?2)`).bind(profile, revision),
    ]);
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB, new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS));
    const checkedAt = '2026-09-23T03:23:00.000Z';
    const admission = await state.claimLane({ collectionId: 'known-manga-run', leaseUntil: '2026-09-23T04:23:00.000Z', now: checkedAt, provider: 'mangaupdates', scheduledFor: checkedAt, tokenDigest: 'm'.repeat(64), window: { from: '2026-09-01', to: '2026-10-01' } });
    if (admission.status !== 'claimed') throw new Error('Expected claimed manga Agenda lane.');
    const events = [1, 2, 3, 4].map((chapter) => ({
      expiresAt: '2026-11-20T00:00:00.000Z', id: `known-manga-${chapter}`,
      occurrence: { kind: 'DATE' as const, value: `2026-09-${String(1 + (chapter - 1) * 7).padStart(2, '0')}` },
      provenance: { fetchedAt: checkedAt, parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates' as const, providerWorkId: 'known-manga', releaseKind: 'chapter' as const,
      sequence: String(chapter), state: 'CONFIRMED' as const,
    }));
    await state.savePage(admission.claim, { complete: true, events, page: 1, provider: 'mangaupdates', received: 4, skippedUnidentified: 0 }, checkedAt);
    await state.completeLane({ checkedAt, claim: admission.claim, provider: 'mangaupdates', scheduledFor: checkedAt });
    await expect(state.publishMergedGeneration(checkedAt)).resolves.toMatchObject({ changed: true });
    expect(await env.PUBLIC_DB.prepare("SELECT interval_days AS intervalDays FROM catalogue_release_model WHERE work_id = 'work_known_manga'").first()).toEqual({ intervalDays: 7 });
    expect(await env.PUBLIC_DB.prepare("SELECT chapter_total AS chapterTotal, last_confirmed_sequence AS lastConfirmedSequence, last_confirmed_on AS lastConfirmedOn FROM catalogue_current_metadata WHERE work_id = 'work_known_manga'").first())
      .toEqual({ chapterTotal: null, lastConfirmedOn: '2026-09-22', lastConfirmedSequence: '4' });
  });
});
