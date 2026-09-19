import { describe, expect, it } from 'vitest';
import { R2PublicReleaseObjectAdapter } from '@tobirink/adapters-cloudflare';

import { createPublicReleaseApp } from './public-release-routes';
import { cloudPolicy } from '../cloud-policy';

const revision = '2026-09-05.1';

function validSnapshot() {
  return {
    entries: [
      { availability: 'official', label: 'Épisode 1', occursAt: '2026-09-05T18:00:00.000Z', releaseId: 'release_1', workId: 'work_frieren' },
    ],
    generatedAt: '2026-09-05T08:00:00.000Z',
    revision,
  };
}

type SnapshotFixture = ReturnType<typeof validSnapshot>;

function releaseBindings(snapshot: SnapshotFixture = validSnapshot()) {
  const reads: string[] = [];
  const values = new Map<string, SnapshotFixture | { revision: string }>([
    ['releases/current.json', { revision }],
    [`releases/snapshots/${revision}.json`, snapshot],
  ]);
  return {
    services: {
      policy: cloudPolicy,
      releases: new R2PublicReleaseObjectAdapter({
        async get(key: string) {
          reads.push(key);
          const value = values.get(key);
          return value ? {
            async json<T>() {
              // SAFETY: the fake mirrors R2's generic JSON contract; the adapter immediately validates this clone with a strict Zod schema.
              return structuredClone(value) as T;
            },
          } : null;
        },
      }),
    },
    reads,
    values,
  };
}

describe('public release routes', () => {
  it('retires the external Agenda ingestion route', async () => {
    const fixture = releaseBindings();
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v2/releases/generations', { method: 'POST' });
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: 'external-agenda-ingestion-retired' });
  });

  it('returns the same public snapshot regardless of caller headers', async () => {
    const fixture = releaseBindings();
    const app = createPublicReleaseApp(fixture.services);
    const first = await app.request('https://api.example/v1/releases', {
      headers: { Authorization: 'Bearer first', Cookie: 'session=first' },
    });
    const second = await app.request('https://api.example/v1/releases', {
      headers: { Authorization: 'Bearer second', Cookie: 'session=second' },
    });

    expect(await first.json()).toEqual(await second.json());
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600');
    expect(first.headers.get('ETag')).toBe(`"releases-${revision}"`);
  });

  it('rejects a stored snapshot containing a private or unknown field', async () => {
    const privateSnapshot = validSnapshot();
    Reflect.set(privateSnapshot, 'userId', 'user_private');
    const fixture = releaseBindings(privateSnapshot);
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v1/releases');
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects request parameters before reading storage', async () => {
    const fixture = releaseBindings();
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v1/releases?user=user_private');
    expect(response.status).toBe(400);
    expect(fixture.reads).toHaveLength(0);
  });

  it('uses the current pointer and supports a conditional response', async () => {
    const fixture = releaseBindings();
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v1/releases', {
      headers: { 'If-None-Match': `"releases-${revision}"` },
    });
    expect(response.status).toBe(304);
    expect(fixture.reads).toEqual(['releases/current.json']);
  });

  it('serves bounded v2 pages with a stable cursor', async () => {
    const fixture = releaseBindings();
    const release = (id: string, value: string) => ({ expiresAt: '2026-11-05T00:00:00.000Z', id, occurrence: { kind: 'INSTANT' as const, value }, provenance: { fetchedAt: '2026-09-05T08:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist' as const, providerWorkId: '42', releaseKind: 'episode' as const, state: 'SCHEDULED' as const });
    const entries = [release('release_1', '2026-09-05T18:00:00.000Z'), release('release_2', '2026-09-06T18:00:00.000Z')];
    const app = createPublicReleaseApp({ ...fixture.services, releaseCalendar: {
      async query(input) { const start = input.cursor ? 1 : 0; const page = entries.slice(start, start + 1); const window = { from: '2026-09-05', to: '2026-09-06' }; return start === 0 ? { entries: page, generatedAt: '2026-09-05T08:00:00.000Z', nextCursor: '2026-09-05T18:00:00.000Z|release_1', revision, window } : { entries: page, generatedAt: '2026-09-05T08:00:00.000Z', revision, window }; },
    } });
    const first = await app.request('https://api.example/v2/releases?from=2026-09-05&to=2026-09-06&limit=1');
    // SAFETY: the route contract returns a JSON object with an optional cursor.
    expect((await first.json() as { nextCursor?: string }).nextCursor).toBe('2026-09-05T18:00:00.000Z|release_1');
    expect(first.headers.get('ETag')).toMatch(/^"releases-v2-[a-f0-9]{64}"$/u);
    const second = await app.request('https://api.example/v2/releases?from=2026-09-05&to=2026-09-06&limit=1&cursor=2026-09-05T18%3A00%3A00.000Z%7Crelease_1');
    // SAFETY: the route contract returns an entries array for every successful page.
    expect((await second.json() as { entries: unknown[] }).entries).toHaveLength(1);
    expect(second.headers.get('ETag')).not.toBe(first.headers.get('ETag'));
  });

  it('keeps v2 byte-compatible and exposes source coverage only on v3', async () => {
    const fixture = releaseBindings();
    const page = { entries: [], generatedAt: '2026-09-14T08:00:00.000Z', revision, window: { from: '2026-09-13', to: '2026-09-29' } };
    const app = createPublicReleaseApp({ ...fixture.services, releaseCalendar: { async query() { return page; } } });
    const v2 = await app.request('https://api.example/v2/releases?from=2026-09-13&to=2026-09-29');
    const v3 = await app.request('https://api.example/v3/releases?from=2026-09-13&to=2026-09-29');
    expect(await v2.json()).toEqual({ entries: [], generatedAt: page.generatedAt, revision });
    expect(await v3.json()).toEqual(page);
    expect(v3.headers.get('ETag')).toMatch(/^"releases-v3-[a-f0-9]{64}"$/u);
  });

  it('serves paginated virtual models to new extensions without changing v3', async () => {
    const fixture = releaseBindings();
    const model = {
      anchor: { date: '2026-09-13', sequence: '1' }, editorialStatus: 'ONGOING' as const,
      exceptions: [], intervalDays: 7, provider: 'anilist' as const, providerWorkId: '42', releaseKind: 'episode' as const,
      provenance: { observedAt: '2026-09-14T08:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' },
      revision: 'a'.repeat(64), validity: { from: '2026-09-13', to: '2026-09-29' }, workId: 'work_42',
    };
    const page = { generatedAt: '2026-09-14T08:00:00.000Z', models: [model], revision: 'models-1-1', window: { from: '2026-09-13', to: '2026-09-29' } };
    const app = createPublicReleaseApp({ ...fixture.services, releaseCalendar: {
      async query() { return { entries: [], generatedAt: page.generatedAt, revision: page.revision, window: page.window }; },
      async queryModels() { return page; },
    } });
    const response = await app.request('https://api.example/v4/release-models?from=2026-09-13&to=2026-09-29&representation=pages');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(page);
    expect(response.headers.get('ETag')).toMatch(/^"release-models-v4-[a-f0-9]{64}"$/u);
    const conditional = await app.request('https://api.example/v4/release-models?from=2026-09-13&to=2026-09-29&representation=pages', { headers: { 'If-None-Match': response.headers.get('ETag')! } });
    expect(conditional.status).toBe(304);
    const otherPage = await app.request('https://api.example/v4/release-models?from=2026-09-13&to=2026-09-29&cursor=work_42&representation=pages', { headers: { 'If-None-Match': response.headers.get('ETag')! } });
    expect(otherPage.status).toBe(200);
    const legacy = await app.request('https://api.example/v4/release-models?from=2026-09-13&to=2026-09-29');
    const legacyNext = await app.request('https://api.example/v4/release-models?from=2026-09-13&to=2026-09-29&cursor=work_42', { headers: { 'If-None-Match': legacy.headers.get('ETag')! } });
    expect(legacyNext.status).toBe(200);
    expect(legacyNext.headers.get('ETag')).toBe(legacy.headers.get('ETag'));
    expect(legacyNext.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    'https://api.example/v3/releases?from=2026-09-01&to=2026-10-11',
    'https://api.example/v3/releases?from=2026-02-30&to=2026-03-01',
    'https://api.example/v3/releases?from=2026-09-01',
    'https://api.example/v2/releases?from=2026-09-01&to=2026-10-11',
    'https://api.example/v2/releases?from=2026-02-30&to=2026-03-01',
    'https://api.example/v4/release-models?from=2026-09-01&to=2026-10-11',
  ])('rejects an unbounded or invalid window before querying D1', async (url) => {
    const fixture = releaseBindings(); let queried = false;
    const app = createPublicReleaseApp({ ...fixture.services, releaseCalendar: { async query() { queried = true; return { entries: [], generatedAt: '2026-09-14T08:00:00.000Z', revision, window: { from: '2026-09-01', to: '2026-10-10' } }; } } });
    const response = await app.request(url);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'invalid-window' }); expect(queried).toBe(false);
  });

  it('rejects malformed v2 cursors before querying D1', async () => {
    const fixture = releaseBindings();
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v2/releases?cursor=release_1');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-cursor' });
  });

  it('returns an explicit unavailable result when the current pointer is missing', async () => {
    const fixture = releaseBindings();
    fixture.values.delete('releases/current.json');
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v1/releases');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'release-snapshot-unavailable' });
  });

  it('serves only versioned public extension artifacts', async () => {
    const fixture = releaseBindings();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } });
    const app = createPublicReleaseApp({
      ...fixture.services,
      releases: {
        readPointer: (...args) => fixture.services.releases.readPointer(...args),
        readSnapshot: (...args) => fixture.services.releases.readSnapshot(...args),
        async readArtifact() { return { body, contentType: 'application/zip', etag: '"zip-1"' }; },
      },
    });
    const response = await app.request('https://api.example/downloads/tobirink-chrome-mv3-1.0.0.zip');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/zip');
    expect(response.headers.get('Content-Disposition')).toContain('tobirink-chrome-mv3-1.0.0.zip');
    await expect(app.request('https://api.example/downloads/private.zip')).resolves.toMatchObject({ status: 400 });
  });
});
