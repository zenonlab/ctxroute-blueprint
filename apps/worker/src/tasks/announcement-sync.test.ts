import { describe, expect, it } from 'vitest';
import announcementSync from './announcement-sync.js';

describe('announcement sync', () => {
  it('persists scheduled and announced states without turning either into availability', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const helpers = { query: async (sql: string, values?: unknown[]) => { queries.push({ sql, values }); return sql.includes('catalog_provider_policy') ? { rows: [{ status: 'AUTHORIZED' }] } : { rows: [] }; } };
    const result = await announcementSync({ provider: 'fixture', announcements: [
      { mediaId: 'm1', releaseKey: 'm1|main|integer|12|default', announcedAt: '2026-08-02T00:00:00Z', status: 'SCHEDULED', provenance: { fixture: true } },
      { mediaId: 'm1', releaseKey: 'm1|main|integer|11|default', announcedAt: '2026-08-01T00:00:00Z', status: 'ANNOUNCED', provenance: { fixture: true } },
    ] }, helpers);
    expect(result).toEqual({ status: 'OK', saved: 2 });
    const inserts = queries.filter(query => query.sql.includes('INSERT INTO release_announcement'));
    expect(queries).toHaveLength(3);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values?.[3]).toBe('SCHEDULED');
    expect(inserts[1].values?.[3]).toBe('ANNOUNCED');
    expect(inserts[0].sql).toContain('ON CONFLICT(provider,release_key)');
  });

  it('does not ingest announcements for an unqualified provider', async () => {
    const queries: string[] = [];
    const result = await announcementSync({ provider: 'unqualified', announcements: [{ mediaId: 'm1', releaseKey: 'r1', announcedAt: '2026-08-02T00:00:00Z', status: 'ANNOUNCED', provenance: {} }] }, { query: async (sql: string) => { queries.push(sql); return { rows: [] }; } });
    expect(result).toEqual({ status: 'SKIPPED', reason: 'provider-policy-not-authorized' });
    expect(queries).toHaveLength(1);
  });
});
