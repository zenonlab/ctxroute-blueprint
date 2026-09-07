import { createFavoriteObservation, createProviderCandidateEnvelope } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { auditFavoriteEquivalenceCorpus, favoriteEquivalenceCorpus } from './equivalence-corpus';
import { assertFavoriteOracleCoverage, runFavoriteEquivalenceOracle } from './equivalence-oracle';
import type { FavoriteEquivalenceFixture, FavoriteOracleSnapshot } from './equivalence-oracle';
import { runCanonicalFavoritePipeline } from './canonical-equivalence-runner';

const observation = createFavoriteObservation({
  bookmarkId: 'bookmark-oracle',
  folderPath: ['Fixtures'],
  observationRevision: 'revision-oracle',
  observationSequence: 1,
  observedAt: '2026-09-07T10:00:00.000Z',
  presence: 'observed',
  siblingOrder: 0,
  title: 'Fixture oracle',
  url: 'https://fixtures.tobirink.invalid/oracle',
});

const completeEnvelope = createProviderCandidateEnvelope({ candidates: [], complete: true, digest: 'digest-complete', provider: 'anilist', truncated: false });
const expected: FavoriteOracleSnapshot = Object.freeze({
  artifact: Object.freeze({ identity: 'fixture-oracle', rawTitle: observation.title }),
  decision: Object.freeze({ kind: 'NO_MATCH' }),
  projection: Object.freeze({ reviewStatus: 'no-match' }),
});

function fixture(overrides: Partial<FavoriteEquivalenceFixture> = {}): FavoriteEquivalenceFixture {
  return { caseId: 'O-01', expected, observation, providerEnvelopes: [completeEnvelope], ...overrides };
}

describe('favorite equivalence corpus', () => {
  it('contains the exact audited 82 / 77 / 4 / 1 contract', () => {
    expect(auditFavoriteEquivalenceCorpus()).toEqual({ conserved: 77, corrected: 4, future: 1, total: 82 });
    expect(new Set(favoriteEquivalenceCorpus.map((item) => item.id)).size).toBe(82);
    expect(favoriteEquivalenceCorpus.filter((item) => item.disposition === 'CORRIGER').map((item) => item.id)).toEqual(['U-02', 'U-10', 'B-03', 'O-02']);
    expect(favoriteEquivalenceCorpus.find((item) => item.id === 'X-01')?.disposition).toBe('FUTUR');
  });

  it('uses only the reserved synthetic origin and labels', () => {
    expect(favoriteEquivalenceCorpus.every((item) => item.syntheticTitle === `Fixture ${item.id}`)).toBe(true);
    expect(favoriteEquivalenceCorpus.every((item) => item.syntheticUrl.startsWith('https://fixtures.tobirink.invalid/'))).toBe(true);
  });

  it('rejects a corpus with a missing or reclassified canonical case', () => {
    expect(() => auditFavoriteEquivalenceCorpus(favoriteEquivalenceCorpus.slice(1))).toThrow(/every canonical case ID/u);
    const reclassified = favoriteEquivalenceCorpus.map((item) => item.id === 'P-01' ? { ...item, disposition: 'CORRIGER' as const } : item);
    expect(() => auditFavoriteEquivalenceCorpus(reclassified)).toThrow(/dispositions/u);
  });
});

describe('favorite equivalence oracle', () => {
  it('deep-compares artifact, decision and projection independent of key order', async () => {
    const actual = { artifact: { rawTitle: observation.title, identity: 'fixture-oracle' }, decision: { kind: 'NO_MATCH' }, projection: { reviewStatus: 'no-match' } };
    await expect(runFavoriteEquivalenceOracle([fixture()], async () => actual)).resolves.toEqual({ caseIds: ['O-01'], passed: 1 });
  });

  it.each(['artifact', 'decision', 'projection'] as const)('fails on a %s divergence', async (field) => {
    const actual = { ...expected, [field]: { changed: true } };
    await expect(runFavoriteEquivalenceOracle([fixture()], async () => actual)).rejects.toThrow(`O-01.${field}`);
  });

  it('fails closed before accepting a decision from a truncated response', async () => {
    const truncated = createProviderCandidateEnvelope({ candidates: [], complete: false, digest: 'digest-truncated', provider: 'anilist', truncated: true });
    await expect(runFavoriteEquivalenceOracle([fixture({ providerEnvelopes: [truncated] })], async () => expected)).rejects.toThrow(/must fail closed/u);
  });

  it('accepts the explicit incomplete-candidate diagnostic for a truncated response', async () => {
    const truncated = createProviderCandidateEnvelope({ candidates: [], complete: false, digest: 'digest-truncated', provider: 'anilist', truncated: true });
    const incomplete = { ...expected, decision: { kind: 'INCOMPLETE_CANDIDATE_SET' } };
    await expect(runFavoriteEquivalenceOracle([fixture({ expected: incomplete, providerEnvelopes: [truncated] })], async () => incomplete)).resolves.toEqual({ caseIds: ['O-01'], passed: 1 });
  });

  it('rejects duplicate case IDs', async () => {
    await expect(runFavoriteEquivalenceOracle([fixture(), fixture()], async () => expected)).rejects.toThrow(/unique/u);
  });

  it('exposes a separate gate that requires all 82 canonical fixtures', () => {
    expect(() => assertFavoriteOracleCoverage([fixture()])).toThrow(/every canonical corpus case/u);
  });

  it('runs parser, matcher and projection for every canonical case', () => {
    const results = runCanonicalFavoritePipeline();
    expect(results).toHaveLength(82);
    expect(results.map(({ caseId }) => caseId)).toEqual(favoriteEquivalenceCorpus.map(({ id }) => id));
    expect(results).toMatchSnapshot();
  });
});
