import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { commitPublicReleaseGeneration, upsertPublicReleaseEvents } from './public-release-collectors';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';

describe('public release contract migration', () => {
  it('backfills canonical providers and textual release numbers without removing v1 columns', async () => {
    await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS.slice(0, 7));
    await env.COLLECTIVE_DB.prepare(`INSERT INTO public_release_event (
      id, provider, provider_work_id, release_kind, sequence_number,
      occurrence_kind, occurrence_value, state, source, fetched_at,
      parser_version, rules_version, expires_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
      .bind('legacy-release', 'mangaUpdates', '42', 'chapter', 58, 'DATE', '2026-09-13', 'CONFIRMED', 'mangaupdates', '2026-09-13T00:00:00.000Z', '1', '1', '2026-11-12T00:00:00.000Z')
      .run();
    await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS.slice(7));
    const row = await env.COLLECTIVE_DB.prepare('SELECT provider, provider_key, sequence_number, sequence_label FROM public_release_event WHERE id = ?1')
      .bind('legacy-release')
      .first<{ provider: string; provider_key: string; sequence_number: number; sequence_label: string }>();
    expect(row).toEqual({ provider: 'mangaUpdates', provider_key: 'mangaupdates', sequence_label: '58', sequence_number: 58 });
  });

  it('writes canonical textual events through the additive columns', async () => {
    await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS);
    const textualEvent = {
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'textual-release', occurrence: { kind: 'DATE', value: '2026-09-13' },
      provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates', providerWorkId: '42', releaseKind: 'chapter', sequence: '29-29.5 (end)', state: 'CONFIRMED',
    } as const;
    await upsertPublicReleaseEvents(env.COLLECTIVE_DB, [textualEvent]);
    const row = await env.COLLECTIVE_DB.prepare('SELECT provider, provider_key, sequence_number, sequence_label FROM public_release_event WHERE id = ?1')
      .bind('textual-release')
      .first<{ provider: string; provider_key: string; sequence_number: number | null; sequence_label: string }>();
    expect(row).toEqual({ provider: 'mangaUpdates', provider_key: 'mangaupdates', sequence_label: '29-29.5 (end)', sequence_number: null });
    await commitPublicReleaseGeneration(env.COLLECTIVE_DB, [textualEvent], { from: '2026-09-13', to: '2026-09-13' }, 'textual-fixture', '2026-09-13T00:00:00.000Z');
    const page = await new D1PublicReleaseCalendarAdapter(env.COLLECTIVE_DB).query({ from: '2026-09-13', limit: 10, to: '2026-09-13' });
    expect(page.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'textual-release', provider: 'mangaupdates', sequence: '29-29.5 (end)' }),
    ]));
  });

  it('commits one generation and pages by occurrence then identity through the covering index', async () => {
    await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS);
    const event = (id: string, value: string) => ({ expiresAt: '2026-11-12T00:00:00.000Z', id, occurrence: { kind: 'INSTANT' as const, value }, provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist' as const, providerWorkId: id, releaseKind: 'episode' as const, state: 'SCHEDULED' as const });
    await commitPublicReleaseGeneration(env.COLLECTIVE_DB, [event('release_z', '2026-09-13T00:00:00.000Z'), event('release_a', '2026-09-14T00:00:00.000Z')], { from: '2026-09-12', to: '2026-09-30' }, 'calendar-fixture', '2026-09-12T00:00:00.000Z');
    const calendar = new D1PublicReleaseCalendarAdapter(env.COLLECTIVE_DB);
    const first = await calendar.query({ from: '2026-09-12', limit: 1, to: '2026-09-30' });
    expect(first).toMatchObject({ entries: [{ id: 'release_z' }], generatedAt: '2026-09-12T00:00:00.000Z', nextCursor: '2026-09-13T00:00:00.000Z|release_z', revision: 'calendar-fixture' });
    await expect(calendar.query({ cursor: first.nextCursor!, from: '2026-09-12', limit: 1, to: '2026-09-30' })).resolves.toMatchObject({ entries: [{ id: 'release_a' }] });
    const plan = await env.COLLECTIVE_DB.prepare("EXPLAIN QUERY PLAN SELECT event.id FROM public_release_generation_event AS event JOIN public_release_active_generation AS active ON active.revision = event.generation_revision AND active.id = 'active' WHERE event.occurrence_value >= ?1 AND event.occurrence_value <= ?2 AND (event.occurrence_value > ?3 OR (event.occurrence_value = ?3 AND event.id > ?4)) ORDER BY event.occurrence_value, event.id LIMIT ?5").bind('2026-09-12', '2026-09-30T23:59:59.999Z', '2026-09-12', '', 2).all<{ detail: string }>();
    expect(plan.results.map(({ detail }) => detail).join(' ')).toContain('public_release_generation_event_cursor_idx');
  });
});
