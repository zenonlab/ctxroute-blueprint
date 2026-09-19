import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';
import { commitPublicReleaseGeneration } from './public-release-collectors';
import { instrumentD1 } from '../operational-metrics';

it('initializes revision metadata from existing models and rolls it back with a failed business transaction', async () => {
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(0, -1));
  await env.PUBLIC_DB.prepare("INSERT INTO catalogue_revisions(revision, published_at) VALUES (787877, '2020-09-12T00:00:00.000Z')").run();
  await env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_preexisting', 'manga', 'Existing', 787877)").run();
  await env.PUBLIC_DB.prepare(`INSERT INTO catalogue_release_model(work_id, provider, provider_work_id, release_kind, anchor_date,
    exceptions_json, valid_from, valid_to, editorial_status, source, observed_at, parser_version, rules_version, model_digest, revision)
    VALUES ('work_preexisting', 'mangaupdates', 'preexisting', 'chapter', '2020-09-12', '[]', '2020-09-01', '2020-10-01',
      'COMPLETED', 'mangaupdates', '2020-09-12T00:00:00.000Z', '2', '2', ?1, 787877)`).bind('a'.repeat(64)).run();
  const before = await env.PUBLIC_DB.prepare("SELECT * FROM catalogue_release_model WHERE work_id = 'work_preexisting'").first();
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(-1));
  expect(await env.PUBLIC_DB.prepare("SELECT * FROM catalogue_release_model WHERE work_id = 'work_preexisting'").first()).toEqual(before);
  const generation = await env.PUBLIC_DB.prepare("SELECT * FROM catalogue_release_generation WHERE id = 'active'").first();
  expect(generation).toMatchObject({ observed_at: '2020-09-12T00:00:00.000Z', revision: expect.stringMatching(/^[a-f0-9]{32}$/u) });
  await expect(env.PUBLIC_DB.batch([
    env.PUBLIC_DB.prepare("UPDATE catalogue_release_model SET editorial_status = 'HIATUS' WHERE work_id = 'work_preexisting'"),
    env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_preexisting', 'manga', 'Duplicate', 787877)"),
  ])).rejects.toThrow();
  expect(await env.PUBLIC_DB.prepare("SELECT * FROM catalogue_release_generation WHERE id = 'active'").first()).toEqual(generation);
  expect(await env.PUBLIC_DB.prepare("SELECT * FROM catalogue_release_model WHERE work_id = 'work_preexisting'").first()).toEqual(before);
});

it('keeps unmodeled history alongside 1001 models and reads a v4 page without scanning all models', async () => {
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
  await env.PUBLIC_DB.prepare("INSERT INTO catalogue_revisions(revision, published_at) VALUES (787878, '2040-09-12T00:00:00.000Z')").run();
  await env.PUBLIC_DB.prepare(`WITH RECURSIVE numbers(i) AS (VALUES(0) UNION ALL SELECT i + 1 FROM numbers WHERE i < 1000)
    INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision)
    SELECT printf('work_transition_%04d', i), 'manga', 'Transition', 787878 FROM numbers`).run();
  await env.PUBLIC_DB.prepare(`INSERT INTO catalogue_release_model(
    work_id, provider, provider_work_id, release_kind, anchor_date, anchor_sequence,
    interval_days, exceptions_json, valid_from, valid_to, editorial_status, source,
    observed_at, parser_version, rules_version, model_digest, revision)
    SELECT work_id, 'mangaupdates', work_id, 'chapter', '2040-09-14', '1', 7, '[]',
      '2040-09-01', '2040-10-01', 'ONGOING', 'mangaupdates', '2040-09-12T00:00:00.000Z', '2', '2', ?1, 787878
    FROM catalogue_works WHERE revision = 787878`).bind('a'.repeat(64)).run();
  const historical = { expiresAt: '2040-11-12T00:00:00.000Z', id: 'historical-unmodeled', occurrence: { kind: 'DATE' as const, value: '2040-09-20' }, provenance: { fetchedAt: '2040-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' }, provider: 'mangaupdates' as const, providerWorkId: 'unverified-history', releaseKind: 'chapter' as const, sequence: '1', state: 'CONFIRMED' as const };
  const stale = { ...historical, id: 'historical-superseded', providerWorkId: 'work_transition_0000' };
  await commitPublicReleaseGeneration(env.PUBLIC_DB, [historical, stale], { from: '2040-09-01', to: '2040-10-01' }, 'transition-history', '2040-09-12T00:00:00.000Z');
  const metrics = instrumentD1(env.PUBLIC_DB);
  const reader = new D1PublicReleaseCalendarAdapter(metrics.database);
  const window = { from: '2040-09-12', to: '2040-10-01', limit: 100 };
  const models = await reader.queryModels(window);
  expect(models.models).toHaveLength(100);
  expect(metrics.snapshot().rowsRead).toBeLessThan(200);
  const first = await reader.query(window);
  expect(first.entries[0]?.id).toBe('historical-unmodeled');
  expect(first.revision).toBe(models.revision);
  const entries = [...first.entries];
  let cursor = first.nextCursor;
  for (let page = 0; cursor !== undefined && page < 20; page += 1) {
    const next = await reader.query({ ...window, cursor });
    expect(next.revision).toBe(first.revision);
    entries.push(...next.entries); cursor = next.nextCursor;
  }
  expect(cursor).toBeUndefined();
  expect(entries).toHaveLength(1002);
  expect(new Set(entries.map(event => event.id)).size).toBe(1002);
  expect(entries.some(event => event.id === stale.id)).toBe(false);
  expect(await env.PUBLIC_DB.prepare("SELECT work_id FROM catalogue_external_references WHERE external_id = 'unverified-history'").first()).toBeNull();
  expect(metrics.snapshot().rowsWritten).toBe(0);
  await env.PUBLIC_DB.prepare("UPDATE catalogue_release_model SET editorial_status = 'HIATUS' WHERE work_id = 'work_transition_0000'").run();
  expect((await reader.queryModels(window)).revision).not.toBe(first.revision);
});
