import { describe, expect, it } from 'vitest';
import { publicReleaseEventSchema } from './release-contracts';

describe('release contracts', () => {
  it('rejects unknown public fields and preserves DATE semantics', () => {
    const result = publicReleaseEventSchema.safeParse({ id: 'anilist-1', provider: 'anilist', providerWorkId: '1', releaseKind: 'episode', occurrence: { kind: 'DATE', value: '2026-09-13' }, state: 'CONFIRMED', provenance: { source: 'anilist', fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-09-14T00:00:00.000Z', privateTitle: 'nope' });
    expect(result.success).toBe(false);
  });

  it('normalizes legacy MangaUpdates events without losing release numbers', () => {
    const base = { id: 'mangaupdates-1', providerWorkId: '1', releaseKind: 'chapter', occurrence: { kind: 'DATE', value: '2026-09-13' }, state: 'CONFIRMED', provenance: { source: 'mangaupdates', fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-11-12T00:00:00.000Z' };
    expect(publicReleaseEventSchema.parse({ ...base, provider: 'mangaUpdates', sequence: 58 })).toMatchObject({ provider: 'mangaupdates', sequence: '58' });
    expect(publicReleaseEventSchema.parse({ ...base, provider: 'mangaupdates', sequence: '58.5' })).toMatchObject({ provider: 'mangaupdates', sequence: '58.5' });
    expect(publicReleaseEventSchema.parse({ ...base, provider: 'mangaupdates', sequence: '2a' })).toMatchObject({ sequence: '2a' });
    expect(() => publicReleaseEventSchema.parse({ ...base, provider: 'mangaupdates', sequence: 'x'.repeat(65) })).toThrow();
  });
});
