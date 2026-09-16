import { describe, expect, it } from 'vitest';
import { workId } from './identity';
import { createWork } from './work';

const candidate = { externalId: '154587', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] };
const base = {
  externalReferences: [{ externalId: candidate.externalId, provider: candidate.provider }],
  hydration: { candidate, favoriteAliasKeys: [], hydratedAt: '2026-09-16T00:00:00.000Z', matcherVersion: '4', providerTitleKeys: ['frieren'] },
  id: workId('work_public_frieren'), mediaKind: 'anime' as const, preferredTitle: 'Frieren',
};

describe('Work public discovery freshness', () => {
  it('preserves canonical verified and refresh timestamps', () => {
    const publicDiscovery = {
      fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, nextRefreshAt: '2026-09-23T00:00:00.000Z',
      parserVersion: '5', siteRulesVersion: '3', verifiedAt: '2026-09-16T00:00:00.000Z',
    };
    expect(createWork({ ...base, hydration: { ...base.hydration, publicDiscovery } }).hydration?.publicDiscovery).toEqual(publicDiscovery);
  });

  it('rejects a non-SHA-256 discovery fingerprint', () => {
    expect(() => createWork({ ...base, hydration: { ...base.hydration, publicDiscovery: {
      fingerprint: 'not-a-digest', mediaKind: 'ANIME', nextRefreshAt: '2026-09-23T00:00:00.000Z',
      parserVersion: '5', siteRulesVersion: '3', verifiedAt: '2026-09-16T00:00:00.000Z',
    } } })).toThrow('Public discovery fingerprint');
  });
});
