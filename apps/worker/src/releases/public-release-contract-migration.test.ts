import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { commitPublicReleaseGeneration, D1AgendaCollectionAdapter, upsertPublicReleaseEvents } from './public-release-collectors';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';
import { instrumentD1 } from '../operational-metrics';

function eventFixture(id: string, value: string) {
  return {
    expiresAt: '2026-11-12T00:00:00.000Z', id, occurrence: { kind: 'INSTANT' as const, value },
    provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' },
    provider: 'anilist' as const, providerWorkId: id, releaseKind: 'episode' as const, state: 'SCHEDULED' as const,
  };
}

describe('public release contract migration', () => {
  it('backfills canonical providers and textual release numbers without removing v1 columns', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(0, 7));
    await env.PUBLIC_DB.prepare(`INSERT INTO public_release_event (
      id, provider, provider_work_id, release_kind, sequence_number,
      occurrence_kind, occurrence_value, state, source, fetched_at,
      parser_version, rules_version, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
      .bind('legacy-release', 'mangaUpdates', '42', 'chapter', 58, 'DATE', '2026-09-13', 'CONFIRMED', 'mangaupdates', '2026-09-13T00:00:00.000Z', '1', '1', '2026-11-12T00:00:00.000Z')
      .run();
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(7));
    const row = await env.PUBLIC_DB.prepare('SELECT provider, provider_key, sequence_number, sequence_label FROM public_release_event WHERE id = ?1')
      .bind('legacy-release')
      .first<{ provider: string; provider_key: string; sequence_number: number; sequence_label: string }>();
    expect(row).toEqual({ provider: 'mangaUpdates', provider_key: 'mangaupdates', sequence_label: '58', sequence_number: 58 });
    expect(await env.PUBLIC_DB.prepare('SELECT provider, sequence_label AS sequenceLabel FROM public_release_current_event WHERE id = ?1')
      .bind('legacy-release').first()).toEqual({ provider: 'mangaupdates', sequenceLabel: '58' });
    const rollback = await env.PUBLIC_DB.prepare("SELECT events_json AS eventsJson FROM public_release_generation WHERE revision = 'legacy-v1'")
      .first<{ eventsJson: string }>();
    expect(JSON.parse(rollback?.eventsJson ?? '[]')).toEqual([
      expect.objectContaining({ id: 'legacy-release', provider: 'mangaupdates', sequence: '58' }),
    ]);
  });

  it('claims one lane once and resumes at page five after four stored pages', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB);
    const input = {
      collectionId: 'collection-a', leaseUntil: '2026-09-16T04:00:00.000Z', now: '2026-09-16T03:00:00.000Z',
      provider: 'anilist' as const, scheduledFor: '2026-09-16T03:23:00.000Z', tokenDigest: 'a'.repeat(64),
      window: { from: '2026-09-15', to: '2026-10-01' },
    };
    const first = await state.claimLane(input);
    expect(first.status).toBe('claimed');
    await expect(state.claimLane({ ...input, collectionId: 'collection-b', tokenDigest: 'b'.repeat(64) })).resolves.toEqual({ status: 'leased' });
    if (first.status !== 'claimed') throw new Error('Expected claimed Agenda lane.');
    for (let page = 1; page <= 4; page += 1) {
      await state.savePage(first.claim, {
        complete: false, events: [], nextPage: page + 1, notBefore: Date.parse(`2026-09-16T03:00:0${page + 1}.000Z`), page,
        provider: 'anilist', received: 0, skippedUnidentified: 0,
      }, `2026-09-16T03:00:0${page}.000Z`);
    }
    await state.failLane({ claim: first.claim, errorCode: 'agenda-anilist-unavailable', provider: 'anilist', retryAt: '2026-09-16T03:02:00.000Z' });
    const resumed = await state.claimLane({ ...input, collectionId: 'collection-c', leaseUntil: '2026-09-16T04:03:00.000Z', now: '2026-09-16T03:03:00.000Z', tokenDigest: 'c'.repeat(64) });
    expect(resumed).toMatchObject({ status: 'claimed', claim: { collectionId: 'collection-a', nextPage: 5 } });
    if (resumed.status !== 'claimed') throw new Error('Expected resumed Agenda lane.');
    await state.failLane({ claim: resumed.claim, errorCode: 'agenda-anilist-unavailable', provider: 'anilist', retryAt: '2026-09-16T03:04:00.000Z' });
  });

  it('writes canonical textual events through the additive columns', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const textualEvent = {
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'textual-release', occurrence: { kind: 'DATE', value: '2026-09-13' },
      provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates', providerWorkId: '42', releaseKind: 'chapter', sequence: '29-29.5 (end)', state: 'CONFIRMED',
    } as const;
    await upsertPublicReleaseEvents(env.PUBLIC_DB, [textualEvent]);
    const row = await env.PUBLIC_DB.prepare('SELECT provider, provider_key, sequence_number, sequence_label FROM public_release_event WHERE id = ?1')
      .bind('textual-release')
      .first<{ provider: string; provider_key: string; sequence_number: number | null; sequence_label: string }>();
    expect(row).toEqual({ provider: 'mangaUpdates', provider_key: 'mangaupdates', sequence_label: '29-29.5 (end)', sequence_number: null });
    await commitPublicReleaseGeneration(env.PUBLIC_DB, [textualEvent], { from: '2026-09-13', to: '2026-09-13' }, 'textual-fixture', '2026-09-13T00:00:00.000Z');
    const page = await new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB).query({ from: '2026-09-13', limit: 10, to: '2026-09-13' });
    expect(page.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'textual-release', provider: 'mangaupdates', sequence: '29-29.5 (end)' }),
    ]));
  });

  it('projects the compact model without writing D1 or advancing a confirmed counter', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare("INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (4242424242, '2026-09-17T00:00:00.000Z')"),
      env.PUBLIC_DB.prepare("INSERT OR IGNORE INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_virtual_agenda', 'manga', 'Virtual', 4242424242)"),
      env.PUBLIC_DB.prepare(`INSERT INTO catalogue_release_model(
        work_id, provider, provider_work_id, release_kind, anchor_date, anchor_sequence,
        interval_days, explicit_next_json, exceptions_json, valid_from, valid_to,
        editorial_status, source, observed_at, parser_version, rules_version, model_digest, revision)
        VALUES ('work_virtual_agenda', 'mangaupdates', '42', 'chapter', '2026-09-14', '58.5',
          7, NULL, '[]', '2026-09-14', '2026-10-01', 'ONGOING', 'mangaupdates',
          '2026-09-17T00:00:00.000Z', '2', '2', ?1, 4242424242)`)
        .bind('a'.repeat(64)),
    ]);
    const metrics = instrumentD1(env.PUBLIC_DB);
    const page = await new D1PublicReleaseCalendarAdapter(metrics.database).query({ from: '2026-09-14', limit: 10, to: '2026-10-01' });
    expect(page).toMatchObject({ entries: [{ occurrence: { kind: 'DATE', value: '2026-09-21' }, state: 'ESTIMATED' }], revision: expect.stringMatching(/^models-[a-f0-9]{48}$/u) });
    const models = await new D1PublicReleaseCalendarAdapter(metrics.database).queryModels({ from: '2026-09-14', limit: 10, to: '2026-10-01' });
    expect(models.revision).toBe(page.revision);
    expect(metrics.snapshot().rowsWritten).toBe(0);
    expect(await env.PUBLIC_DB.prepare("SELECT episode_total AS episodeTotal, chapter_total AS chapterTotal FROM catalogue_current_metadata WHERE work_id = 'work_virtual_agenda'").first()).toBeNull();
    await env.PUBLIC_DB.prepare("DELETE FROM catalogue_release_model WHERE work_id = 'work_virtual_agenda'").run();
  });

  it('commits one generation and pages by occurrence then identity through the covering index', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const event = (id: string, value: string) => ({ expiresAt: '2026-11-12T00:00:00.000Z', id, occurrence: { kind: 'INSTANT' as const, value }, provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist' as const, providerWorkId: id, releaseKind: 'episode' as const, state: 'SCHEDULED' as const });
    await commitPublicReleaseGeneration(env.PUBLIC_DB, [event('release_z', '2026-09-13T00:00:00.000Z'), event('release_a', '2026-09-14T00:00:00.000Z')], { from: '2026-09-12', to: '2026-09-30' }, 'calendar-fixture', '2026-09-14T00:00:00.000Z');
    const calendar = new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB);
    const first = await calendar.query({ from: '2026-09-12', limit: 1, to: '2026-09-30' });
    expect(first).toMatchObject({ entries: [{ id: 'release_z' }], generatedAt: '2026-09-14T00:00:00.000Z', nextCursor: '2026-09-13T00:00:00.000Z|release_z', revision: 'calendar-fixture' });
    await expect(calendar.query({ cursor: first.nextCursor!, from: '2026-09-12', limit: 1, to: '2026-09-30' })).resolves.toMatchObject({ entries: [{ id: 'release_a' }] });
    const plan = await env.PUBLIC_DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM public_release_current_event WHERE occurrence_value >= ?1 AND occurrence_value <= ?2 AND (occurrence_value > ?3 OR (occurrence_value = ?3 AND id > ?4)) ORDER BY occurrence_value, id LIMIT ?5").bind('2026-09-12', '2026-09-30T23:59:59.999Z', '2026-09-12', '', 2).all<{ detail: string }>();
    expect(plan.results.map(({ detail }) => detail).join(' ')).toContain('public_release_current_event_cursor_idx');
  });

  it('serves v3 from an active R2 snapshot while completing a missing lane from legacy D1', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const legacy = {
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'legacy-manga', occurrence: { kind: 'DATE' as const, value: '2026-09-14' },
      provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates' as const, providerWorkId: 'legacy-manga', releaseKind: 'chapter' as const, state: 'CONFIRMED' as const,
    };
    await commitPublicReleaseGeneration(env.PUBLIC_DB, [legacy], { from: '2026-09-12', to: '2026-09-30' }, 'legacy-transition', '2026-09-14T00:00:00.000Z');
    const current = eventFixture('r2-anime', '2026-09-13T00:00:00.000Z');
    const snapshots = {
      async readLane(provider: 'anilist' | 'mangaupdates') {
        return provider === 'anilist'
          ? { activeDigest: 'a'.repeat(64), activeSnapshotId: 'snapshot-a', checkedAt: '2026-09-17T03:23:00.000Z' }
          : { activeDigest: null, activeSnapshotId: null, checkedAt: null };
      },
      async readPageVersion(key: string) {
        return key === 'snapshots/anilist/snapshot-a' ? { complete: true, events: [current] } : undefined;
      },
    };
    const metrics = instrumentD1(env.PUBLIC_DB);
    const calendar = new D1PublicReleaseCalendarAdapter(metrics.database, snapshots);
    const first = await calendar.query({ from: '2026-09-12', limit: 1, to: '2026-09-30' });
    expect(first).toMatchObject({ entries: [{ id: 'r2-anime' }], nextCursor: '2026-09-13T00:00:00.000Z|r2-anime', revision: expect.stringMatching(/^r2-compat-/u) });
    expect(first.revision).toMatch(/^[A-Za-z0-9._-]{1,64}$/u);
    await expect(calendar.query({ cursor: first.nextCursor!, from: '2026-09-12', limit: 1, to: '2026-09-30' }))
      .resolves.toMatchObject({ entries: [{ id: 'legacy-manga' }] });
    expect(metrics.snapshot().rowsWritten).toBe(0);
  });

  it('replays the same complete generation and never replaces it with an older one', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const event = {
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'shared-refresh-release', occurrence: { kind: 'DATE' as const, value: '2026-09-14' },
      provenance: { fetchedAt: '2026-09-14T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates' as const, providerWorkId: 'shared-work', releaseKind: 'chapter' as const, sequence: '1', state: 'CONFIRMED' as const,
    };
    const calendar = new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB);
    const current = { events: [event], generatedAt: '2026-09-15T00:00:00.000Z', nonce: '795f05e6-2370-4b34-8818-1f02498555ee', schemaVersion: 1 as const, window: { from: '2026-09-13', to: '2026-09-28' } };
    const first = await calendar.ingest(current);
    await expect(calendar.ingest({ ...current, nonce: '3c67cc7f-1c55-448a-a3ce-aa989794234f' })).resolves.toMatchObject({ accepted: true, replayed: true, revision: first.revision });
    const stale = await calendar.ingest({ ...current, generatedAt: '2026-09-14T12:00:00.000Z', nonce: '30225ff8-6a45-49ad-809d-dbd62d8483d1' });
    expect(stale.accepted).toBe(false);
    await expect(calendar.query({ from: '2026-09-13', limit: 10, to: '2026-09-28' })).resolves.toMatchObject({ revision: first.revision, entries: [{ id: 'shared-refresh-release' }] });
    const rows = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_current_event').first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it('fails closed when an active generation row no longer matches the public contract', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const event = {
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'corrupt-release', occurrence: { kind: 'DATE' as const, value: '2026-09-14' },
      provenance: { fetchedAt: '2026-09-14T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates' as const, providerWorkId: '42', releaseKind: 'chapter' as const, sequence: '1', state: 'CONFIRMED' as const,
    };
    const active = await env.PUBLIC_DB.prepare("SELECT generated_at AS generatedAt FROM public_release_generation WHERE status = 'active'").first<{ generatedAt: string }>();
    const generatedAt = new Date(Date.parse(active?.generatedAt ?? '2026-09-14T00:00:00.000Z') + 86_400_000).toISOString();
    await commitPublicReleaseGeneration(env.PUBLIC_DB, [event], { from: '2026-09-13', to: '2026-09-29' }, 'calendar-corrupt', generatedAt);
    await env.PUBLIC_DB.prepare("UPDATE public_release_current_event SET provider = 'unknown' WHERE id = 'corrupt-release'").run();
    await expect(new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB).query({ from: '2026-09-13', limit: 10, to: '2026-09-29' })).rejects.toThrow();
  });

  it('retains the active generation and only two rollback generations', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const event = {
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'retained-release', occurrence: { kind: 'DATE' as const, value: '2026-09-14' },
      provenance: { fetchedAt: '2026-09-14T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates' as const, providerWorkId: '42', releaseKind: 'chapter' as const, sequence: '1', state: 'CONFIRMED' as const,
    };
    const active = await env.PUBLIC_DB.prepare("SELECT generated_at AS generatedAt FROM public_release_generation WHERE status = 'active'").first<{ generatedAt: string }>();
    const base = Date.parse(active?.generatedAt ?? '2026-09-14T00:00:00.000Z');
    for (const [index, revision] of ['calendar-retention-1', 'calendar-retention-2', 'calendar-retention-3', 'calendar-retention-4'].entries()) {
      await commitPublicReleaseGeneration(env.PUBLIC_DB, [{ ...event, id: `${event.id}-${index}` }], { from: '2026-09-13', to: '2026-09-29' }, revision, new Date(base + (index + 1) * 86_400_000).toISOString());
    }
    const generations = await env.PUBLIC_DB.prepare('SELECT revision, status FROM public_release_generation ORDER BY generated_at').all<{ revision: string; status: string }>();
    expect(generations.results).toEqual([
      { revision: 'calendar-retention-2', status: 'staging' },
      { revision: 'calendar-retention-3', status: 'staging' },
      { revision: 'calendar-retention-4', status: 'active' },
    ]);
    expect((await env.PUBLIC_DB.prepare('SELECT id FROM public_release_current_event ORDER BY id').all()).results)
      .toEqual([{ id: 'retained-release-3' }]);
    const snapshots = await env.PUBLIC_DB.prepare('SELECT events_json AS eventsJson FROM public_release_generation ORDER BY generated_at').all<{ eventsJson: string }>();
    expect(snapshots.results).toHaveLength(3);
    expect(snapshots.results.every(({ eventsJson }) => JSON.parse(eventsJson) instanceof Array)).toBe(true);
  });

  it('keeps event rows unchanged when a weekly snapshot is semantically identical', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const state = new D1AgendaCollectionAdapter(env.PUBLIC_DB);
    const weeklyEvent = {
      ...eventFixture('weekly-release', '2026-09-20T12:00:00.000Z'),
      expiresAt: '2026-11-20T12:00:00.000Z',
    };
    const run = async (collectionId: string, scheduledFor: string, checkedAt: string, fetchedAt: string, events = [weeklyEvent]) => {
      const tokenDigest = collectionId.padEnd(64, '0');
      const admission = await state.claimLane({ collectionId, leaseUntil: new Date(Date.parse(checkedAt) + 60 * 60_000).toISOString(), now: checkedAt, provider: 'anilist', scheduledFor, tokenDigest, window: { from: '2026-09-15', to: '2026-10-01' } });
      if (admission.status !== 'claimed') throw new Error('Expected claimed Agenda lane.');
      await state.savePage(admission.claim, { complete: true, events: events.map((event) => ({ ...event, provenance: { ...event.provenance, fetchedAt } })), page: 1, provider: 'anilist', received: events.length, skippedUnidentified: 0 }, checkedAt);
      return state.completeLane({ checkedAt, claim: admission.claim, provider: 'anilist', scheduledFor });
    };
    const base = Date.parse((await env.PUBLIC_DB.prepare("SELECT generated_at AS generatedAt FROM public_release_generation WHERE status = 'active'").first<{ generatedAt: string }>())?.generatedAt ?? '2026-09-16T00:00:00.000Z');
    const firstCheck = new Date(base + 86_400_000).toISOString();
    const secondCheck = new Date(base + 8 * 86_400_000).toISOString();
    const first = await run('weekly-a', firstCheck, firstCheck, firstCheck);
    expect(first.changed).toBe(true);
    const published = await state.publishMergedGeneration(firstCheck);
    expect(published?.changed).toBe(true);
    expect(published?.count).toBeGreaterThan(0);
    const before = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_current_event').first<{ count: number }>();
    const failedCheck = new Date(base + 2 * 86_400_000).toISOString();
    const failedAdmission = await state.claimLane({ collectionId: 'weekly-failed', leaseUntil: new Date(Date.parse(failedCheck) + 60 * 60_000).toISOString(), now: failedCheck, provider: 'anilist', scheduledFor: failedCheck, tokenDigest: 'f'.repeat(64), window: { from: '2026-09-15', to: '2026-10-01' } });
    if (failedAdmission.status !== 'claimed') throw new Error('Expected claimed failed Agenda lane.');
    await state.failLane({ claim: failedAdmission.claim, errorCode: 'agenda-anilist-unavailable', provider: 'anilist', retryAt: new Date(Date.parse(failedCheck) + 60_000).toISOString() });
    const retained = await env.PUBLIC_DB.prepare("SELECT active_snapshot_id AS activeSnapshotId FROM public_release_agenda_lane_state WHERE provider = 'anilist'").first<{ activeSnapshotId: string }>();
    expect(retained?.activeSnapshotId).toBe('weekly-a');
    const second = await run('weekly-b', secondCheck, secondCheck, secondCheck);
    expect(second.changed).toBe(false);
    await expect(state.publishMergedGeneration(secondCheck)).resolves.toMatchObject({ changed: false, count: published?.count, revision: published?.revision });
    const after = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_current_event').first<{ count: number }>();
    expect(after).toEqual(before);
    const freshness = await env.PUBLIC_DB.prepare('SELECT checked_at AS checkedAt FROM public_release_generation WHERE revision = ?1').bind(published?.revision).first<{ checkedAt: string }>();
    expect(freshness?.checkedAt).toBe(secondCheck);
    const thirdCheck = new Date(base + 15 * 86_400_000).toISOString();
    const third = await run('weekly-c', thirdCheck, thirdCheck, thirdCheck, [
      weeklyEvent,
      eventFixture('weekly-release-2', '2026-09-27T12:00:00.000Z'),
    ]);
    expect(third.changed).toBe(true);
    const changedPublication = await state.publishMergedGeneration(thirdCheck);
    expect(changedPublication).toMatchObject({ changed: true });
    expect(changedPublication?.revision).not.toBe(published?.revision);
    const newGeneration = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_generation WHERE revision = ?1').bind(changedPublication?.revision).first<{ count: number }>();
    expect(newGeneration?.count).toBe(1);
  });
});
