import { describe, expect, it, vi } from 'vitest';
import { instrumentAgendaR2, instrumentD1, instrumentProviderFetch } from './operational-metrics';
import { env } from 'cloudflare:test';

describe('operational metrics', () => {
  it('counts R2 operations and conditional conflicts without exposing object keys', async () => {
    const metrics = instrumentAgendaR2(env.RELEASE_SNAPSHOTS);
    const options = { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } };
    await metrics.bucket.put('metrics/r2-counter', '{}', options);
    await expect(metrics.bucket.put('metrics/r2-counter', '{}', options)).resolves.toBeNull();
    await metrics.bucket.get('metrics/r2-counter');
    await metrics.bucket.list?.({ prefix: 'metrics/', limit: 1 });
    expect(metrics.snapshot()).toEqual({ r2Reads: 1, r2Writes: 2, r2Lists: 1, r2Conflicts: 1 });
  });
  it('sums only D1Result meta without inspecting query values', async () => {
    const statement = {
      all: vi.fn(async () => ({ meta: { rows_read: 3, rows_written: 0 }, results: [{ value: 1 }], success: true })),
      bind: vi.fn(), first: vi.fn(), raw: vi.fn(),
      run: vi.fn(async () => ({ meta: { rows_read: 2, rows_written: 1 }, results: [], success: true })),
    };
    statement.bind.mockReturnValue(statement);
    const database: D1Database = Object.assign(Object.create(null), {
      batch: vi.fn(async () => [{ meta: { rows_read: 4, rows_written: 2 }, results: [], success: true }]),
      dump: vi.fn(), exec: vi.fn(), prepare: vi.fn(() => statement), withSession: vi.fn(),
    });
    const metrics = instrumentD1(database);
    await metrics.database.prepare('SELECT value').first();
    await metrics.database.prepare('UPDATE value').run();
    await metrics.database.batch([metrics.database.prepare('INSERT value')]);
    expect(statement.first).not.toHaveBeenCalled();
    expect(metrics.snapshot()).toEqual({ rowsRead: 9, rowsWritten: 3 });
  });

  it('counts real provider HTTP requests by bounded provider name', async () => {
    const upstream = vi.fn(async (input: string) => new Response('{}', {
      status: input.includes('anilist') ? 429 : input.includes('mangaupdates') ? 503 : 200,
    }));
    const metrics = instrumentProviderFetch(upstream);
    expect((await metrics.fetch('https://graphql.anilist.co', {})).status).toBe(429);
    expect((await metrics.fetch('https://api.mangaupdates.com/v1/releases/search', {})).status).toBe(503);
    expect((await metrics.fetch('https://tobirink.com/v3/releases', {})).status).toBe(200);
    expect(metrics.snapshot()).toEqual({ anilist: 1, kitsu: 0, mangadex: 0, mangaupdates: 1 });
    expect(Object.keys(metrics.snapshot())).toEqual(['anilist', 'kitsu', 'mangadex', 'mangaupdates']);
  });

  it('uses native row metadata instead of multiplying writes by payload size', async () => {
    const statement = {
      all: vi.fn(), bind: vi.fn(), first: vi.fn(), raw: vi.fn(),
      run: vi.fn(async () => ({ meta: { rows_read: 0, rows_written: 1 }, results: [{ payload: 'x'.repeat(64_000) }], success: true })),
    };
    statement.bind.mockReturnValue(statement);
    const database: D1Database = Object.assign(Object.create(null), {
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(), prepare: vi.fn(() => statement), withSession: vi.fn(),
    });
    const metrics = instrumentD1(database);
    await metrics.database.prepare('INSERT synthetic payload').run();
    expect(metrics.snapshot()).toEqual({ rowsRead: 0, rowsWritten: 1 });
  });
});
