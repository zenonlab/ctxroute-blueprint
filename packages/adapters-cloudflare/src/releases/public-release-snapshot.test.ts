import { describe, expect, it } from 'vitest';

import { parsePublicReleaseSnapshot, publicReleaseSnapshotSchema, PublicReleaseSnapshotAdapter } from './public-release-snapshot';

function snapshot() {
  return {
    entries: [
      { availability: 'official', label: 'Épisode 2', occursAt: '2026-09-12T18:00:00.000Z', releaseId: 'release_2', workId: 'work_frieren' },
      { availability: 'confirmed', label: 'Épisode 1', occursAt: '2026-09-05T18:00:00.000Z', releaseId: 'release_1', workId: 'work_frieren' },
    ],
    generatedAt: '2026-09-05T08:00:00.000Z',
    revision: '2026-09-05.1',
  };
}

describe('public release snapshot', () => {
  it('keeps only the strict public shape in deterministic order', () => {
    const parsed = parsePublicReleaseSnapshot(snapshot());
    expect(parsed.entries.map((entry) => entry.releaseId)).toEqual(['release_1', 'release_2']);
    expect(Object.keys(parsed)).toEqual(['entries', 'generatedAt', 'revision']);
  });

  it('rejects personal, unknown and duplicate fields', () => {
    expect(() => publicReleaseSnapshotSchema.parse({ ...snapshot(), userId: 'user_private' })).toThrow();
    const duplicate = snapshot();
    duplicate.entries[1] = duplicate.entries[0];
    expect(() => parsePublicReleaseSnapshot(duplicate)).toThrow('Duplicate');
  });

  it('persists a validated network snapshot then uses it offline', async () => {
    let online = true;
    let cached: ReturnType<typeof snapshot> | undefined;
    const adapter = new PublicReleaseSnapshotAdapter(
      { async loadLatest() { if (!online) throw new Error('offline'); return snapshot(); } },
      { async load() { return cached; }, async save(value) { cached = structuredClone(value); } },
    );

    expect((await adapter.latest()).source).toBe('network');
    online = false;
    const offline = await adapter.latest();
    expect(offline.source).toBe('cache');
    expect(offline.snapshot.revision).toBe('2026-09-05.1');
  });

  it('does not invent an offline snapshot when no valid cache exists', async () => {
    const adapter = new PublicReleaseSnapshotAdapter(
      { async loadLatest() { throw new Error('offline'); } },
      { async load() { return undefined; }, async save() {} },
    );
    await expect(adapter.latest()).rejects.toThrow('unavailable');
  });
});
