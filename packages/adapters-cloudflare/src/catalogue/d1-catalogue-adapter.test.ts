import { describe, expect, it } from 'vitest';
import { D1PublicCatalogueAdapter } from './d1-catalogue-adapter';

describe('D1PublicCatalogueAdapter', () => {
  it('owns the prepared query and forwards only bounded values', async () => {
    const calls: Array<{ query: string; values: Array<number | string | null> }> = [];
    const database = {
      prepare(query: string) {
        const values: Array<number | string | null> = [];
        const call = { query, values };
        calls.push(call);
        return {
          all: async <TResult>() => {
            // SAFETY: the fake row matches every projected catalogue work field used by the methods exercised in this test.
            const results = [{ id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2 }] as TResult[];
            return { results };
          },
          bind(...values: Array<number | string | null>) {
            call.values = values;
            return this;
          },
          first: async <TResult>() => {
            // SAFETY: the fake row matches the catalogue work projection requested by both single-row adapter methods.
            return { id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2 } as TResult;
          },
        };
      },
    };

    const adapter = new D1PublicCatalogueAdapter(database);
    await expect(adapter.listWorksAfter({ id: 'work_dandadan', revision: 1 }, 51)).resolves.toHaveLength(1);
    await expect(adapter.findWork('work_frieren')).resolves.toMatchObject({ id: 'work_frieren' });
    await expect(adapter.resolveReference('anilist', '154587')).resolves.toMatchObject({ id: 'work_frieren' });
    await expect(adapter.searchWorksByTitle('Frieren', 6)).resolves.toHaveLength(1);

    expect(calls.map(({ values }) => values)).toEqual([
      [1, 'work_dandadan', 51],
      ['work_frieren'],
      ['anilist', '154587'],
      ['Frieren', 6],
    ]);
    expect(calls.every(({ query }) => query.includes('?1'))).toBe(true);
  });

  it('binds a bounded favorite-key batch as one JSON value and correlates misses', async () => {
    const calls: Array<{ query: string; values: Array<number | string | null> }> = [];
    const database = {
      prepare(query: string) {
        // SAFETY: this fake records only values accepted by the D1 port's SqlValue boundary.
        const call = { query, values: [] as Array<number | string | null> }; calls.push(call);
        return {
          bind(...values: Array<number | string | null>) { call.values = values; return this; },
          // SAFETY: this row contains every projected field consumed by the batch adapter.
          all: async <TResult>() => ({ results: [{ requestedFingerprint: 'a'.repeat(64), identityHash: 'identity', mediaKind: 'ANIME', metadataJson: '{"preSerialization":false}', referencesJson: '[{"provider":"anilist","externalId":"1"}]' }] as TResult[] }),
          // SAFETY: the batch path never calls first; the fake still satisfies the complete statement port.
          first: async <TResult>() => null as TResult | null,
        };
      },
    };
    const keys = [
      { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: 'parser-v3', siteRulesVersion: 'rules-v3' },
      { fingerprint: 'b'.repeat(64), mediaKind: 'MANGA' as const, parserVersion: 'parser-v3', siteRulesVersion: 'rules-v3' },
    ];
    const adapter = new D1PublicCatalogueAdapter(database);
    await expect(adapter.findFavoriteIdentities(keys)).resolves.toEqual([
      { fingerprint: keys[0]?.fingerprint, identity: { mediaKind: 'ANIME', metadata: { preSerialization: false }, references: [{ provider: 'anilist', externalId: '1' }] } },
      { fingerprint: keys[1]?.fingerprint },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain('FROM json_each(?1)');
    expect(calls[0]?.values).toEqual([JSON.stringify(keys)]);
  });
});
