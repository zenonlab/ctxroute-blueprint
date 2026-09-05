import { describe, expect, it } from 'vitest';
import { R2PublicReleaseObjectAdapter } from './r2-release-snapshot-store';

interface StoredFixture {
  entries?: Array<{ availability: string; label: string; occursAt: string; releaseId: string; workId: string }>;
  generatedAt?: string;
  revision: string;
  userId?: string;
}

function object(value: StoredFixture) {
  return {
    async json<T>() {
      // SAFETY: the fake mirrors R2's generic JSON contract; the adapter validates the returned clone before exposing it.
      return structuredClone(value) as T;
    },
  };
}

describe('R2PublicReleaseObjectAdapter', () => {
  it('validates pointers and snapshots at the provider boundary', async () => {
    const values = new Map<string, StoredFixture>([
      ['current', { revision: '2026-09-05.1' }],
      ['snapshot', {
        entries: [{ availability: 'official', label: 'Épisode 1', occursAt: '2026-09-05T18:00:00.000Z', releaseId: 'release_1', workId: 'work_frieren' }],
        generatedAt: '2026-09-05T08:00:00.000Z',
        revision: '2026-09-05.1',
      }],
    ]);
    const adapter = new R2PublicReleaseObjectAdapter({
      async get(key) {
        const value = values.get(key);
        return value ? object(value) : null;
      },
    });

    await expect(adapter.readPointer('current')).resolves.toEqual({ revision: '2026-09-05.1' });
    await expect(adapter.readSnapshot('snapshot')).resolves.toMatchObject({ revision: '2026-09-05.1' });
    await expect(adapter.readPointer('missing')).resolves.toBeUndefined();
  });

  it('rejects private fields before data reaches a route', async () => {
    const adapter = new R2PublicReleaseObjectAdapter({ async get() { return object({ revision: 'valid', userId: 'private' }); } });
    await expect(adapter.readPointer('current')).rejects.toThrow();
  });
});
