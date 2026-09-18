import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { resolve } from 'node:path';
import { Script, createContext } from 'node:vm';
import { createFavoriteObservation, createProviderCandidateEnvelope, createSourceEvidence } from '@tobirink/domain';
import type { SourceEvidence } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extractFavoriteSourceEvidence } from '../../packages/application/src/favorites/source-evidence';
import { parseFavoriteObservation } from '../../packages/application/src/favorites/favorite-parser';
import { matchFavoriteTitles } from '../../packages/application/src/favorites/provider-matcher';
import { readSafeParenthesizedFavoriteTitle } from '../../packages/application/src/favorites/title-normalization';

const referenceCommit = '3267de240fe5e68aa6a42a33dc77883cbdcd255d';
const referencePath = 'packages/metadata/src/bookmark-parser.ts';
const referenceDigest = '548f22d14ea381f21ab92e42a5d5ee7bc11d6f42eb5dc40bf22a704b3572294d';
const referenceMetadataPath = 'packages/metadata/src/index.ts';
const referenceMetadataDigest = '76affc39b22fd2dda4905a2e82baed753ab751048d1caf24c2b80c462aca9938';
const configuredRoot = process.env.FAVLIB_READONLY_ROOT;
const favlibRoot = resolve(configuredRoot ?? '../FavLib');
const available = existsSync(resolve(favlibRoot, '.git'));

interface ReferenceParser {
  parseFavorite(input: { title: string; url: string; source: ReferenceSource }): {
    displayTitle: string | null;
    progression: { kind: string; number: number } | null;
    status: string;
  };
}

interface ReferenceSource {
  key: string;
  rawSlug: string;
  releaseSuffix?: string;
  slug: string;
  title: string;
  type: DifferentialCase['mediaKind'];
}

const referenceArtifactSchema = z.object({ displayTitle: z.string().nullable(), progression: z.object({ kind: z.string(), number: z.number() }).nullable(), status: z.string() });
const referenceSourceSchema = z.object({ key: z.string(), rawSlug: z.string(), releaseSuffix: z.string().optional(), slug: z.string(), title: z.string(), type: z.string() });
const referenceParserSchema = z.object({ parseFavorite: z.function({ input: [z.object({ source: referenceSourceSchema, title: z.string(), url: z.string() })], output: referenceArtifactSchema }) });

interface DifferentialCase {
  classification: 'intentional-improvement' | 'retained-behavior';
  id: string;
  mediaKind: 'ANIME' | 'MANGA' | 'MANHWA';
  rawSlug: string;
  release?: { kind: 'chapter' | 'episode'; raw: string; value: number };
  stableSlug: string;
  title: string;
  url: string;
}

const cases: readonly DifferentialCase[] = Object.freeze([
  { classification: 'retained-behavior', id: 'chapter', mediaKind: 'MANGA', rawSlug: 'synthetic-glass-harbor', release: { kind: 'chapter', raw: 'chapter-20', value: 20 }, stableSlug: 'synthetic-glass-harbor', title: 'Synthetic Glass Harbor - Chapter 20', url: 'https://reader.invalid/series/synthetic-glass-harbor/chapter-20' },
  { classification: 'retained-behavior', id: 'routing-prefix', mediaKind: 'MANHWA', rawSlug: '0906168628-synthetic-lineage-protocol', release: { kind: 'chapter', raw: 'chapter-31', value: 31 }, stableSlug: 'synthetic-lineage-protocol', title: 'Synthetic Lineage Protocol - Chapter 31', url: 'https://reader.invalid/series/0906168628-synthetic-lineage-protocol/chapter-31' },
  { classification: 'intentional-improvement', id: 'routing-suffix', mediaKind: 'MANHWA', rawSlug: 'synthetic-shadow-chronicle-006', release: { kind: 'chapter', raw: 'chapter-66.1', value: 66.1 }, stableSlug: 'synthetic-shadow-chronicle', title: 'Synthetic Shadow Chronicle 006', url: 'https://reader.invalid/webtoon/synthetic-shadow-chronicle-006/chapter-66.1' },
  { classification: 'retained-behavior', id: 'intrinsic-number', mediaKind: 'MANGA', rawSlug: 'area-51', stableSlug: 'area-51', title: 'Area 51', url: 'https://reader.invalid/manga/area-51' },
  { classification: 'retained-behavior', id: 'episode', mediaKind: 'ANIME', rawSlug: 'synthetic-orbit', release: { kind: 'episode', raw: 'episode-9', value: 9 }, stableSlug: 'synthetic-orbit', title: 'Synthetic Orbit - Episode 9', url: 'https://video.invalid/anime/synthetic-orbit/episode-9' },
  { classification: 'retained-behavior', id: 'opaque-route', mediaKind: 'MANGA', rawSlug: 'route-zx731904', release: { kind: 'chapter', raw: 'chapter-31', value: 31 }, stableSlug: 'route-zx731904', title: 'Synthetic Ember Ledger - Chapter 31', url: 'https://reader.invalid/series/route-zx731904/chapter-31' },
]);

function loadReferenceParser(): ReferenceParser {
  const source = execFileSync('git', ['-C', favlibRoot, 'show', `${referenceCommit}:${referencePath}`], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  expect(createHash('sha256').update(source).digest('hex')).toBe(referenceDigest);
  const compiled = `${stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false }).replace(/\bexport\s+(?=(?:const|function|class)\b)/gu, '')}\nmodule.exports = { parseFavorite };`;
  if (/\brequire\s*\(|\bprocess\b|\bfetch\s*\(/u.test(compiled)) throw new Error('FavLib reference parser exceeds the isolated oracle boundary.');
  const module = { exports: {} };
  const context = createContext({ module, exports: module.exports, URL, TextEncoder });
  new Script(compiled, { filename: 'favlib-reference-parser.cjs' }).runInContext(context, { timeout: 1_000 });
  return referenceParserSchema.parse(module.exports);
}

function projectReference(parser: ReferenceParser, fixture: DifferentialCase) {
  const source: ReferenceSource = { key: `oracle:${fixture.id}`, rawSlug: fixture.rawSlug, slug: fixture.rawSlug, title: fixture.rawSlug.replace(/-/gu, ' '), type: fixture.mediaKind };
  if (fixture.release !== undefined) source.releaseSuffix = fixture.release.raw;
  const artifact = parser.parseFavorite({ source, title: fixture.title, url: fixture.url });
  return { progress: artifact.progression === null ? undefined : { kind: artifact.progression.kind, value: artifact.progression.number }, status: artifact.status, title: artifact.displayTitle ?? undefined };
}

function projectTobiRink(fixture: DifferentialCase) {
  const observation = createFavoriteObservation({ bookmarkId: `oracle-${fixture.id}`, folderPath: ['Synthetic'], observationRevision: 'oracle-v1', observationSequence: 1, observedAt: '2026-09-12T12:00:00.000Z', presence: 'observed', siblingOrder: 0, title: fixture.title, url: fixture.url });
  const transformations: SourceEvidence['identityTransformations'] = fixture.rawSlug !== fixture.stableSlug ? [fixture.id === 'routing-suffix' ? 'numeric-routing-suffix' : 'numeric-routing-prefix'] : [];
  const common: Parameters<typeof createSourceEvidence>[0] = { aliases: [], diagnostics: [], identityTransformations: transformations, key: `oracle:${fixture.id}`, mediaKind: fixture.mediaKind, origin: new URL(fixture.url).origin, path: new URL(fixture.url).pathname, proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], rawSlug: fixture.rawSlug, sourceAdapter: 'favlib-differential-v1', stableSlug: fixture.stableSlug, strategy: 'generic', title: fixture.stableSlug.replace(/-/gu, ' ') };
  const withRelease: Parameters<typeof createSourceEvidence>[0] = fixture.release === undefined ? common : { ...common, release: { ...fixture.release, provenance: 'URL_PATH' }, releaseSuffix: fixture.release.raw };
  const evidence = createSourceEvidence(withRelease);
  const artifact = parseFavoriteObservation(observation, evidence);
  return { progress: artifact.progress === undefined ? undefined : { kind: artifact.progress.kind, value: artifact.progress.value }, status: artifact.status, title: artifact.displayTitle };
}

function normalizedTitle(value: string | undefined): string | undefined {
  return value?.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Load the pinned URL extractor and its pure helpers, never its provider clients.
function loadRawReference() {
  const read = (path: string, digest: string) => {
    const source = execFileSync('git', ['-C', favlibRoot, 'show', `${referenceCommit}:${path}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    expect(createHash('sha256').update(source).digest('hex')).toBe(digest);
    return source;
  };
  const metadata = read(referenceMetadataPath, referenceMetadataDigest);
  const names = new Set(['decode', 'slugTitle', 'compactTitleKey', 'normalizeTitle', 'titleCandidateFromBookmark', 'stripCatalogMarketingSuffix', 'pathReleaseSegment', 'cleanUrlTitle', 'sourceIdentityFromUrl']);
  const helpers = [...metadata.matchAll(/^(?:export )?function (\w+)\([^]*?^\}/gmu)].filter(match => names.has(match[1] ?? '')).map(match => match[0]);
  expect(helpers).toHaveLength(names.size);
  const constants = [...metadata.matchAll(/^const RELEASE_(?:WORDS|PREFIX) = .+;$/gmu)].map(match => match[0]);
  expect(constants).toHaveLength(2);
  const source = read(referencePath, referenceDigest) + '\n' + [...constants, ...helpers].join('\n');
  const compiled = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false }).replace(/\bexport\s+(?=(?:const|function|class)\b)/gu, '');
  if (/\brequire\s*\(|\bprocess\b|\bfetch\s*\(/u.test(compiled)) throw new Error('Raw oracle exceeds the pure reference boundary.');
  const context = createContext({ URL, TextEncoder });
  new Script(compiled).runInContext(context, { timeout: 1_000 });
  return (title: string, url: string) => {
    context.input = { title, url };
    return referenceArtifactSchema.parse(new Script('parseFavorite({ ...input, source: sourceIdentityFromUrl(input.url) })').runInContext(context, { timeout: 1_000 }));
  };
}

describe.runIf(available)('raw title + URL differential reference', () => {
  it.each([
    ['category', 'Synthetic Harbor', '/manga/synthetic-harbor'],
    ['chapter', 'Synthetic Harbor Chapter 42', '/manga/synthetic-harbor/chapter-42'],
    ['opaque', 'Synthetic Harbor - Chapter 42', '/manga/route-zx731904/chapter-42'],
  ])('preserves raw behavior: %s', (_id, title, path) => {
    const url = `https://reader.invalid${path}`;
    const expected = loadRawReference()(title, url);
    const observation = createFavoriteObservation({ bookmarkId: 'raw', folderPath: [], observationRevision: 'raw-v1', observationSequence: 1, observedAt: '2026-09-18T12:00:00.000Z', presence: 'observed', siblingOrder: 0, title, url });
    const actual = parseFavoriteObservation(observation, extractFavoriteSourceEvidence({ sourceKey: 'raw', title, url }));
    expect(normalizedTitle(actual.displayTitle)).toBe(normalizedTitle(expected.displayTitle ?? undefined));
    expect(actual.status).toBe(expected.status);
  });
  it('intentionally preserves intrinsic numbers lost by the raw historical extractor', () => {
    const title = 'Area 51'; const url = 'https://reader.invalid/manga/area-51';
    expect(normalizedTitle(loadRawReference()(title, url).displayTitle ?? undefined)).toBe('area');
    expect(extractFavoriteSourceEvidence({ sourceKey: 'intrinsic-number', title, url }).title).toBe('area 51');
  });
});

describe.runIf(available)('readonly FavLib differential oracle', () => {
  it('retains the pinned parenthesized identity behavior with stricter qualifier guards', () => {
    const source = execFileSync('git', ['-C', favlibRoot, 'show', `${referenceCommit}:${referenceMetadataPath}`], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
    expect(createHash('sha256').update(source).digest('hex')).toBe(referenceMetadataDigest);
    expect(source).toContain('export function exactTitleMatchKind');
    expect(source).toContain('export function explicitTitleAliases');
    const provider = (externalId: string, title: string) => ({ externalId, mediaKind: 'MANGA' as const, preSerialization: false, provider: 'mangaupdates' as const, titles: [title] });
    const envelope = createProviderCandidateEnvelope({ candidates: [provider('base', 'Existence'), provider('wangho', 'Existence (Wangho)')], complete: true, digest: 'parenthesized-oracle', provider: 'mangaupdates', truncated: false });
    expect(matchFavoriteTitles({ sourceTitles: ['Existence'] }, [envelope])).toMatchObject({ kind: 'AMBIGUOUS', level: 'ordered-exact' });
    expect(readSafeParenthesizedFavoriteTitle('Existence (Wangho)')).toEqual({ alternate: 'Wangho', base: 'Existence' });
    expect(readSafeParenthesizedFavoriteTitle('Existence (2024)')).toBeUndefined();
  });
  it('executes the pinned reference and classifies every synthetic difference', () => {
    const reference = loadReferenceParser();
    const results = cases.map((fixture) => ({ fixture, reference: projectReference(reference, fixture), tobirink: projectTobiRink(fixture) }));
    for (const result of results) {
      if (result.fixture.classification === 'retained-behavior') {
        expect({ ...result.tobirink, title: normalizedTitle(result.tobirink.title) })
          .toEqual({ ...result.reference, title: normalizedTitle(result.reference.title) });
      }
      else {
        expect(result.fixture.id).toBe('routing-suffix');
        expect(result.reference.title).toBe('synthetic shadow chronicle 006');
        expect(result.tobirink).toMatchObject({ progress: { kind: 'chapter', value: 66.1 }, status: 'parsed', title: 'Synthetic Shadow Chronicle' });
      }
    }
    expect(results.map(({ fixture }) => [fixture.id, fixture.classification])).toEqual([
      ['chapter', 'retained-behavior'], ['routing-prefix', 'retained-behavior'], ['routing-suffix', 'intentional-improvement'],
      ['intrinsic-number', 'retained-behavior'], ['episode', 'retained-behavior'], ['opaque-route', 'retained-behavior'],
    ]);
  });

  it.each([
    { id: 'chapter-brand', stableSlug: 'synthetic-hero-return', title: 'Chapter 51 | Synthetic Hero Return | Reader Harbor' },
    { id: 'special-marketing', stableSlug: 'synthetic-golden-courier', title: 'Synthetic Golden Courier | Special Episode 2 [END] | Read Free Comics Online' },
    { id: 'chapter-source', stableSlug: 'synthetic-artifact-appraiser', title: 'Synthetic Artifact Appraiser | Chapter 18 | Void Reader' },
  ])('keeps the FavLib identity while excluding unrelated title segments: $id', ({ id, stableSlug, title }) => {
    const reference = loadReferenceParser();
    const fixture: DifferentialCase = { classification: 'retained-behavior', id, mediaKind: 'MANGA', rawSlug: stableSlug, stableSlug, title, url: `https://reader.invalid/series/${stableSlug}/chapter-51`, release: { kind: 'chapter', raw: 'chapter-51', value: 51 } };
    expect(normalizedTitle(projectTobiRink(fixture).title)).toBe(normalizedTitle(projectReference(reference, fixture).title));
    expect(normalizedTitle(projectTobiRink(fixture).title)).toBe(normalizedTitle(stableSlug));
  });
});

if (configuredRoot !== undefined && !available) throw new Error('FAVLIB_READONLY_ROOT does not name a Git checkout.');
