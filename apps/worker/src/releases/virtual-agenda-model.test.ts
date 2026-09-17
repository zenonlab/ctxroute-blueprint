import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';
import { D1AgendaCollectionAdapter } from './public-release-collectors';

describe('virtual Agenda model publication', () => {
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
      .toEqual({ exceptions: '[]', explicitNext: null });
    const firstModel = await env.PUBLIC_DB.prepare("SELECT model_digest AS modelDigest, observed_at AS observedAt FROM catalogue_release_model WHERE work_id = 'work_known_agenda'").first();
    await expect(new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB).queryModels({ from: '2026-09-15', limit: 100, to: '2026-10-01' }))
      .resolves.toMatchObject({ models: expect.arrayContaining([expect.objectContaining({ workId: 'work_known_agenda' })]), revision: expect.stringMatching(/^models-\d+-2$/u) });
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
