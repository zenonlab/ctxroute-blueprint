import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { commitPublicReleaseGeneration, upsertPublicReleaseEvents } from './public-release-collectors';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';

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

  it('commits one generation and pages by occurrence then identity through the covering index', async () => {
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
    const event = (id: string, value: string) => ({ expiresAt: '2026-11-12T00:00:00.000Z', id, occurrence: { kind: 'INSTANT' as const, value }, provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist' as const, providerWorkId: id, releaseKind: 'episode' as const, state: 'SCHEDULED' as const });
    await commitPublicReleaseGeneration(env.PUBLIC_DB, [event('release_z', '2026-09-13T00:00:00.000Z'), event('release_a', '2026-09-14T00:00:00.000Z')], { from: '2026-09-12', to: '2026-09-30' }, 'calendar-fixture', '2026-09-14T00:00:00.000Z');
    const calendar = new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB);
    const first = await calendar.query({ from: '2026-09-12', limit: 1, to: '2026-09-30' });
    expect(first).toMatchObject({ entries: [{ id: 'release_z' }], generatedAt: '2026-09-14T00:00:00.000Z', nextCursor: '2026-09-13T00:00:00.000Z|release_z', revision: 'calendar-fixture' });
    await expect(calendar.query({ cursor: first.nextCursor!, from: '2026-09-12', limit: 1, to: '2026-09-30' })).resolves.toMatchObject({ entries: [{ id: 'release_a' }] });
    const plan = await env.PUBLIC_DB.prepare("EXPLAIN QUERY PLAN SELECT id FROM public_release_generation_event WHERE generation_revision = ?1 AND occurrence_value >= ?2 AND occurrence_value <= ?3 AND (occurrence_value > ?4 OR (occurrence_value = ?4 AND id > ?5)) ORDER BY occurrence_value, id LIMIT ?6").bind('calendar-fixture', '2026-09-12', '2026-09-30T23:59:59.999Z', '2026-09-12', '', 2).all<{ detail: string }>();
    expect(plan.results.map(({ detail }) => detail).join(' ')).toContain('public_release_generation_event_cursor_idx');
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
    const rows = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_release_generation_event WHERE generation_revision = ?1').bind(first.revision).first<{ count: number }>();
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
    await env.PUBLIC_DB.prepare("UPDATE public_release_generation_event SET provider = 'unknown' WHERE generation_revision = 'calendar-corrupt'").run();
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
    const removedEvents = await env.PUBLIC_DB.prepare("SELECT COUNT(*) AS count FROM public_release_generation_event WHERE generation_revision = 'calendar-retention-1'").first<{ count: number }>();
    expect(removedEvents?.count).toBe(0);
  });
});
