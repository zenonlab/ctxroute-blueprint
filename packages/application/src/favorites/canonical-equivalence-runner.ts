import { createFavoriteObservation, createProviderCandidateEnvelope } from '@tobirink/domain';
import type { FavoriteParseArtifact, ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { favoriteEquivalenceCorpus } from './equivalence-corpus';
import type { FavoriteOracleDecision, FavoriteOracleSnapshot, FavoriteOracleValue } from './equivalence-oracle';
import { parseFavoriteObservation } from './favorite-parser';
import { matchFavoriteTitles } from './provider-matcher';
import type { FavoriteTitleMatchOutcome, FavoriteTitleMatchQuery } from './provider-matcher';
import { extractFavoriteSourceEvidence } from './source-evidence';

interface CanonicalProjection { readonly reviewStatus: 'no-match' | 'pending' | 'resolved' }
type OracleSource = FavoriteParseArtifact | FavoriteTitleMatchOutcome | CanonicalProjection;
const oracleValueSchema = z.json();
const oracleDecisionSchema = z.object({ kind: z.string() }).catchall(z.json());

const titles: Readonly<Record<string, string>> = Object.freeze({
  'P-01': '  L’Épopée!!  ', 'P-02': 'Space   Work', 'P-03': 'Journey Great', 'P-04': 'Frieran', 'P-07': 'Long Work Subtitle', 'P-08': 'Running Heroes',
  'T-01': 'Watch Fixture T-01', 'T-02': '[OAV VOSTFR] Fixture T-02', 'T-03': 'Fixture T-03 Episode 12', 'T-04': 'Fixture T-04 12 VOSTFR',
  'T-05': 'Fixture T-05 - Lecture en ligne', 'T-06': 'Fixture T-06 - fixtures', 'T-07': 'Fixture T-07 | Fixture T-07', 'T-08': 'Scan Hero',
  'T-09': 'Alice’s Fixture!', 'T-10': 'Fixture T-10 2024', 'S-01': 'Fixture S-01 Season 4', 'S-02': 'Fixture S-02 4th Season',
  'S-07': 'Fixture S-07 Saison 2', 'R-01': 'Fixture R-01 Chapter 12', 'R-02': 'Fixture R-02 épisode 12,5', 'R-04': 'Fixture R-04 Chapter 20 Chapter 12',
  'R-06': 'Fixture R-06 2024', 'R-10': 'Area 51', 'R-12': 'Fixture 2nd', 'R-13': 'Fixture R-13 Season 2',
});

const urls: Readonly<Record<string, string>> = Object.freeze({
  'U-01': 'https://fixtures.tobirink.invalid/anime/fixture-u-01', 'U-02': 'https://fixtures.tobirink.invalid/read/fixture-u-02/chapter-12',
  'U-03': 'https://fixtures.tobirink.invalid/manga/12345', 'U-04': 'https://anilist.co/anime/154587/fixture-u-04',
  'U-05': 'https://fixtures.tobirink.invalid/manga/fixture-u-05/chapter-12', 'U-06': 'https://fixtures.tobirink.invalid/manga/fixture-u-06-chapter-12',
  'U-07': 'https://anime-fixtures.tobirink.invalid/scan/fixture-u-07', 'U-08': 'https://fixtures.tobirink.invalid/catalogue/',
  'U-09': 'https://fixtures.tobirink.invalid/drama/fixture-u-09', 'U-10': 'http://fixtures.tobirink.invalid/anime/fixture-u-10',
  'S-04': 'https://fixtures.tobirink.invalid/anime/fixture-s-04/season4', 'S-05': 'https://fixtures.tobirink.invalid/anime/fixture-s-05-season-2',
  'S-06': 'https://fixtures.tobirink.invalid/anime/fixture-s-06-season-3', 'R-03': 'https://fixtures.tobirink.invalid/manga/fixture-r-03/chapter-12.5',
  'R-07': 'https://fixtures.tobirink.invalid/manga/12345/12', 'R-08': 'https://fixtures.tobirink.invalid/manga/fixture-r-08/12',
  'R-11': 'https://fixtures.tobirink.invalid/manga/12345/12', 'R-14': 'https://fixtures.tobirink.invalid/anime/fixture-r-14-season-3/episode-12',
});

function oracleValue(value: OracleSource): FavoriteOracleValue { return oracleValueSchema.parse(value); }

function oracleDecision(value: FavoriteTitleMatchOutcome): FavoriteOracleDecision {
  return Object.freeze(oracleDecisionSchema.parse(value));
}

function candidates(caseId: string, title: string, mediaKind: 'ANIME' | 'MANGA'): readonly ProviderCandidate[] {
  if (caseId === 'P-05') return Object.freeze([
    { externalId: 'one', mediaKind, preSerialization: false, provider: 'anilist', titles: [title] },
    { externalId: 'two', mediaKind, preSerialization: false, provider: 'anilist', titles: [title] },
  ]);
  if (caseId === 'P-07' || caseId === 'P-08') return Object.freeze([{ externalId: 'other', mediaKind, preSerialization: false, provider: 'anilist', titles: ['Different Work'] }]);
  const candidate: ProviderCandidate = { externalId: `candidate-${caseId.toLowerCase()}`, mediaKind, preSerialization: caseId === 'F-02', provider: 'anilist', titles: [caseId === 'P-03' ? 'Great Journey' : title] };
  if (caseId === 'F-01') return Object.freeze([{ ...candidate, format: 'OVA' }]);
  if (caseId === 'C-01') return Object.freeze([{ ...candidate, categories: ['Explicit-Séx'] }]);
  if (caseId === 'C-02') return Object.freeze([{ ...candidate, categories: ['Discussion of explicit sex in literature'] }]);
  return Object.freeze([candidate]);
}

function projection(decision: FavoriteTitleMatchOutcome): CanonicalProjection {
  if (decision.kind === 'MATCH') return Object.freeze({ reviewStatus: 'resolved' });
  if (decision.kind === 'NO_MATCH') return Object.freeze({ reviewStatus: 'no-match' });
  return Object.freeze({ reviewStatus: 'pending' });
}

export function runCanonicalFavoritePipeline(): readonly Readonly<{ caseId: string; snapshot: FavoriteOracleSnapshot }>[] {
  return Object.freeze(favoriteEquivalenceCorpus.map((manifest, index) => {
    const title = titles[manifest.id] ?? manifest.syntheticTitle;
    const titleSlug = title.trim().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('fr').replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
    const url = urls[manifest.id] ?? `https://fixtures.tobirink.invalid/anime/${titleSlug}`;
    const observation = createFavoriteObservation({ bookmarkId: `oracle-${manifest.id}`, folderPath: ['Fixtures'], observationRevision: `oracle-${manifest.id}-v1`, observationSequence: index, observedAt: '2026-09-07T12:00:00.000Z', presence: 'observed', siblingOrder: index, title, url });
    const evidence = extractFavoriteSourceEvidence({ sourceKey: observation.bookmarkId, title, url });
    const artifact = parseFavoriteObservation(observation, evidence);
    const sourceTitles = [artifact.displayTitle, ...(artifact.aliases ?? []).map((alias) => alias.value)].filter((value): value is string => value !== undefined);
    const safeTitles = sourceTitles.length > 0 ? sourceTitles : [title];
    const mediaKind = artifact.mediaKind === 'MANGA' ? 'MANGA' : 'ANIME';
    const envelope = createProviderCandidateEnvelope({ candidates: candidates(manifest.id, safeTitles[0] ?? title, mediaKind), complete: true, digest: `oracle-${manifest.id}`, provider: 'anilist', truncated: false });
    const query: FavoriteTitleMatchQuery = manifest.id === 'F-01' ? { mediaKind, sourceFormat: 'OVA', sourceTitles: safeTitles } : { mediaKind, sourceTitles: safeTitles };
    const decision = matchFavoriteTitles(query, [envelope]);
    const snapshot = Object.freeze({ artifact: oracleValue(artifact), decision: oracleDecision(decision), projection: oracleValue(projection(decision)) });
    return Object.freeze({ caseId: manifest.id, snapshot });
  }));
}
