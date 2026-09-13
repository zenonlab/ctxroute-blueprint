import { applyD1Migrations, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { upsertPublicReleaseEvents } from './public-release-collectors';
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
    await upsertPublicReleaseEvents(env.COLLECTIVE_DB, [{
      expiresAt: '2026-11-12T00:00:00.000Z', id: 'textual-release', occurrence: { kind: 'DATE', value: '2026-09-13' },
      provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates', providerWorkId: '42', releaseKind: 'chapter', sequence: '29-29.5 (end)', state: 'CONFIRMED',
    }]);
    const row = await env.COLLECTIVE_DB.prepare('SELECT provider, provider_key, sequence_number, sequence_label FROM public_release_event WHERE id = ?1')
      .bind('textual-release')
      .first<{ provider: string; provider_key: string; sequence_number: number | null; sequence_label: string }>();
    expect(row).toEqual({ provider: 'mangaUpdates', provider_key: 'mangaupdates', sequence_label: '29-29.5 (end)', sequence_number: null });
    const page = await new D1PublicReleaseCalendarAdapter(env.COLLECTIVE_DB).query({ from: '2026-09-13', limit: 10, to: '2026-09-13' });
    expect(page.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'textual-release', provider: 'mangaupdates', sequence: '29-29.5 (end)' }),
    ]));
  });
});
