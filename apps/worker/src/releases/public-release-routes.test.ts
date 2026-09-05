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

  it('returns an explicit unavailable result when the current pointer is missing', async () => {
    const fixture = releaseBindings();
    fixture.values.delete('releases/current.json');
    const response = await createPublicReleaseApp(fixture.services).request('https://api.example/v1/releases');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'release-snapshot-unavailable' });
  });
});
