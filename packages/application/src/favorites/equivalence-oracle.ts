import type { FavoriteObservation, ProviderCandidateEnvelope } from '@tobirink/domain';
import { favoriteEquivalenceCorpus } from './equivalence-corpus';
import type { FavoriteEquivalenceManifestCase } from './equivalence-corpus';

export type FavoriteOracleValue = null | boolean | number | string | readonly FavoriteOracleValue[] | Readonly<{ [key: string]: FavoriteOracleValue }>;

export interface FavoriteOracleDecision {
  readonly [key: string]: FavoriteOracleValue;
  readonly kind: string;
}

export interface FavoriteOracleSnapshot {
  readonly artifact: FavoriteOracleValue;
  readonly decision: FavoriteOracleDecision;
  readonly projection: FavoriteOracleValue;
}

export interface FavoriteEquivalenceFixture {
  readonly caseId: string;
  readonly expected: FavoriteOracleSnapshot;
  readonly observation: FavoriteObservation;
  readonly providerEnvelopes: readonly ProviderCandidateEnvelope[];
}

export interface FavoriteOracleReceipt {
  readonly caseIds: readonly string[];
  readonly passed: number;
}

export type FavoriteEquivalenceAnalyzer = (fixture: FavoriteEquivalenceFixture) => FavoriteOracleSnapshot | Promise<FavoriteOracleSnapshot>;

export function assertFavoriteOracleCoverage(fixtures: readonly FavoriteEquivalenceFixture[], corpus: readonly FavoriteEquivalenceManifestCase[] = favoriteEquivalenceCorpus): void {
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.caseId));
  const corpusIds = new Set(corpus.map((item) => item.id));
  if (fixtureIds.size !== fixtures.length) throw new Error('Favorite oracle fixture IDs must be unique.');
  if (fixtures.length !== corpus.length || [...corpusIds].some((id) => !fixtureIds.has(id))) throw new Error('Favorite oracle fixtures must cover every canonical corpus case exactly once.');
}

function canonicalJson(value: FavoriteOracleValue): string {
  if (value === null || Array.isArray(value)) {
    if (value === null) return 'null';
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const tag = Object.prototype.toString.call(value);
  if (tag === '[object Number]' && !Number.isFinite(value)) throw new Error('Favorite oracle snapshots require finite numbers.');
  if (tag !== '[object Object]') return JSON.stringify(value);
  return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}

function assertSnapshot(caseId: string, expected: FavoriteOracleSnapshot, actual: FavoriteOracleSnapshot): void {
  for (const field of ['artifact', 'decision', 'projection'] as const) {
    if (canonicalJson(expected[field]) !== canonicalJson(actual[field])) throw new Error(`Favorite equivalence divergence for ${caseId}.${field}.`);
  }
}

function decisionKind(snapshot: FavoriteOracleSnapshot): string {
  return snapshot.decision.kind;
}

export async function runFavoriteEquivalenceOracle(fixtures: readonly FavoriteEquivalenceFixture[], analyze: FavoriteEquivalenceAnalyzer): Promise<FavoriteOracleReceipt> {
  const ids = new Set(fixtures.map((fixture) => fixture.caseId));
  if (ids.size !== fixtures.length) throw new Error('Favorite oracle fixture IDs must be unique.');
  const passed: string[] = [];
  for (const fixture of fixtures) {
    const actual = await analyze(fixture);
    if (fixture.providerEnvelopes.some((envelope) => !envelope.complete || envelope.truncated) && decisionKind(actual) !== 'INCOMPLETE_CANDIDATE_SET') {
      throw new Error(`Favorite equivalence divergence for ${fixture.caseId}.decision: incomplete candidate set must fail closed.`);
    }
    assertSnapshot(fixture.caseId, fixture.expected, actual);
    passed.push(fixture.caseId);
  }
  return Object.freeze({ caseIds: Object.freeze(passed), passed: passed.length });
}

export async function runCanonicalFavoriteEquivalenceOracle(fixtures: readonly FavoriteEquivalenceFixture[], analyze: FavoriteEquivalenceAnalyzer): Promise<FavoriteOracleReceipt> {
  assertFavoriteOracleCoverage(fixtures);
  return runFavoriteEquivalenceOracle(fixtures, analyze);
}
