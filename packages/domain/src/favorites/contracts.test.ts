import { describe, expect, it } from 'vitest';
import {
  createFavoriteObservation,
  createFavoriteParseArtifact,
  createProviderCandidateEnvelope,
  createResolutionDecision,
  createSourceEvidence,
  favoriteObservationByteLimit,
  isContentVisible,
  utf8ByteLength,
} from './contracts';

const observation = () => createFavoriteObservation({
  bookmarkId: 'bookmark-contract',
  folderPath: ['Lectures'],
  observationRevision: 'revision-1',
  observationSequence: 1,
  observedAt: '2026-09-07T10:00:00.000Z',
  presence: 'observed',
  siblingOrder: 0,
  title: 'Œuvre synthétique',
  url: 'https://fixtures.tobirink.invalid/work',
});

describe('favorite pipeline contracts', () => {
  it('X-02 strips provider progress fields from canonical candidates', () => {
    const input = { candidates: [{ externalId: 'manga', lastChapter: 42, lastVolume: 7, mediaKind: 'MANGA' as const, preSerialization: false, provider: 'mangaupdates' as const, titles: ['Fixture'] }], complete: true, digest: 'x-02', provider: 'mangaupdates' as const, truncated: false };
    const [candidate] = createProviderCandidateEnvelope(input).candidates;
    expect(candidate).not.toHaveProperty('lastChapter');
    expect(candidate).not.toHaveProperty('lastVolume');
  });
  it('preserves classification and hides only explicit adult content', () => {
    const base = { externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Fixture'] };
    const candidates = (['adult', 'non-adult', 'unknown'] as const).map((contentClassification) => createProviderCandidateEnvelope({
      candidates: [{ ...base, contentClassification }], complete: true, digest: contentClassification,
      provider: 'anilist', truncated: false,
    }).candidates[0]);
    expect(candidates.map((candidate) => candidate?.contentClassification)).toEqual(['adult', 'non-adult', 'unknown']);
    expect(candidates.map((candidate) => isContentVisible(candidate, false))).toEqual([false, true, true]);
    expect(isContentVisible(undefined, false)).toBe(true);
  });
  it('preserves raw strings, freezes nested values and counts UTF-8 bytes', () => {
    const value = observation();
    expect(value.title).toBe('Œuvre synthétique');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.folderPath)).toBe(true);
    expect(utf8ByteLength('é🙂')).toBe(6);
  });

  it('fails closed when observation limits are exceeded', () => {
    expect(() => observation() && createFavoriteObservation({ ...observation(), title: 'a'.repeat(8 * 1024 + 1) })).toThrow(/title exceeds/u);
    expect(() => createFavoriteObservation({ ...observation(), folderPath: Array.from({ length: 33 }, () => 'folder') })).toThrow(/32 segments/u);
    expect(utf8ByteLength(JSON.stringify(observation()))).toBeLessThan(favoriteObservationByteLimit);
  });

  it.each(['not a URL', 'ftp://fixtures.tobirink.invalid/work'])('preserves a bounded raw URL before qualification: %s', (url) => {
    expect(createFavoriteObservation({ ...observation(), url }).url).toBe(url);
  });

  it('rejects decisions from incomplete or truncated provider sets', () => {
    const incomplete = createProviderCandidateEnvelope({ candidates: [], complete: false, digest: 'digest-1', provider: 'anilist', truncated: true });
    expect(() => createResolutionDecision({ candidateReferences: [], kind: 'NO_MATCH', level: 'ordered-exact', reasons: ['none'] }, [incomplete])).toThrow(/INCOMPLETE_CANDIDATE_SET/u);
  });

  it('rejects contradictory and oversized provider envelopes', () => {
    expect(() => createProviderCandidateEnvelope({ candidates: [], complete: true, digest: 'digest-contradictory', provider: 'anilist', truncated: true })).toThrow(/cannot be truncated/u);
    const candidate = { externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Fixture'] };
    expect(() => createProviderCandidateEnvelope({ candidates: Array.from({ length: 21 }, () => candidate), complete: true, digest: 'digest-oversized', provider: 'anilist', truncated: false })).toThrow(/20 entries/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, titles: ['a'.repeat(8 * 1024 + 1)] }], complete: true, digest: 'digest-title', provider: 'anilist', truncated: false })).toThrow(/titles\[0\] exceeds/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, externalId: 'a'.repeat(8 * 1024 + 1) }], complete: true, digest: 'digest-id', provider: 'anilist', truncated: false })).toThrow(/externalId exceeds/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, genres: ['a'.repeat(121)] }], complete: true, digest: 'digest-genre', provider: 'anilist', truncated: false })).toThrow(/genres\[0\] exceeds/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, format: 'a'.repeat(121) }], complete: true, digest: 'digest-format', provider: 'anilist', truncated: false })).toThrow(/format exceeds/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, canonicalUrl: 'ftp://example.invalid/work' }], complete: true, digest: 'digest-url', provider: 'anilist', truncated: false })).toThrow(/HTTP\(S\)/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, cover: { attribution: 'AniList', url: 'http://s4.anilist.co/file.jpg' } }], complete: true, digest: 'digest-cover-http', provider: 'anilist', truncated: false })).toThrow(/HTTPS/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, cover: { attribution: 'AniList', url: 'https://images.invalid/file.jpg' } }], complete: true, digest: 'digest-cover-origin', provider: 'anilist', truncated: false })).toThrow(/not allowed/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, titleVariants: Array.from({ length: 17 }, () => ({ title: 'Alias' })) }], complete: true, digest: 'digest-title-variants', provider: 'anilist', truncated: false })).toThrow(/16 entries/u);
    expect(() => createProviderCandidateEnvelope({ candidates: [{ ...candidate, season: 0 }], complete: true, digest: 'digest-season', provider: 'anilist', truncated: false })).toThrow(/positive safe integer/u);
  });

  it('validates a complete artifact and unique matching decision', () => {
    const artifact = createFavoriteParseArtifact({
      contractVersion: 2,
      diagnostics: [],
      identityKey: 'oeuvre synthetique',
      mediaKind: 'ANIME',
      parserVersion: 'favorite-parser-v2',
      raw: { title: observation().title, url: observation().url },
      semanticFingerprint: 'sha256:fixture',
      sourceAdapterVersion: 'source-adapter-v1',
      sourceEvidence: { aliases: [{ provenance: 'stable-url-slug', value: 'oeuvre synthetique' }], diagnostics: [], key: 'bookmark-1', mediaKind: 'ANIME', proofs: ['TITLE_SLUG'], sourceAdapter: 'generic', strategy: 'generic' },
      transformations: ['opaque-url-slug-replaced'],
    });
    const envelope = createProviderCandidateEnvelope({ candidates: [{ externalId: '1', mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Œuvre synthétique'] }], complete: true, digest: 'digest-2', provider: 'anilist', truncated: false });
    const reference = { externalId: '1', provider: 'anilist' as const };
    const decision = createResolutionDecision({ candidateReferences: [reference], kind: 'MATCH', level: 'ordered-exact', matchedReference: reference, reasons: ['unique'] }, [envelope]);
    expect(artifact.raw).toEqual({ title: observation().title, url: observation().url });
    expect(decision.kind).toBe('MATCH');
  });

  it('bounds and validates structured source evidence', () => {
    const base = { aliases: [], diagnostics: [], key: 'bookmark-source', mediaKind: 'UNKNOWN' as const, proofs: [], sourceAdapter: 'generic-url', strategy: 'generic' as const };
    expect(() => createSourceEvidence({ ...base, origin: 'https://fixtures.tobirink.invalid/path' })).toThrow(/origin/u);
    expect(() => createSourceEvidence({ ...base, explicitProviderReference: { externalId: '', provider: 'anilist' } })).toThrow(/externalId/u);
    expect(() => createSourceEvidence({ ...base, stableSlug: 'a'.repeat(32 * 1024 + 1) })).toThrow(/stableSlug/u);
    expect(() => createSourceEvidence({ ...base, canonicalUrl: 'https://other.tobirink.invalid/work', origin: 'https://fixtures.tobirink.invalid' })).toThrow(/declared origin/u);
    expect(() => createSourceEvidence({ ...base, disposition: 'INVALID_URL', title: 'invented identity' })).toThrow(/actionable identity/u);
    const evidence = createSourceEvidence({ ...base, explicitProviderReference: { externalId: '1', provider: 'anilist' }, release: { kind: 'episode', provenance: 'URL_PATH', raw: 'episode-1', value: 1 } });
    expect(Object.isFrozen(evidence.explicitProviderReference)).toBe(true);
    expect(Object.isFrozen(evidence.release)).toBe(true);
  });

  it.each([
    ['not a URL', 'INVALID_URL'],
    ['ftp://fixtures.tobirink.invalid/work', 'NON_WEB_URL'],
  ] as const)('requires fail-closed evidence for rejected raw URL %s', (url, disposition) => {
    const base = {
      contractVersion: 2 as const,
      diagnostics: [],
      mediaKind: 'UNKNOWN' as const,
      parserVersion: 'favorite-parser-v2',
      raw: { title: observation().title, url },
      semanticFingerprint: 'sha256:fixture-rejected',
      sourceAdapterVersion: 'source-adapter-v1',
      sourceEvidence: { aliases: [], diagnostics: [], disposition, key: 'bookmark-rejected', mediaKind: 'UNKNOWN' as const, proofs: [], sourceAdapter: 'generic-url', strategy: 'generic' as const },
      transformations: [],
    };
    expect(createFavoriteParseArtifact(base).raw.url).toBe(url);
    expect(() => createFavoriteParseArtifact({ ...base, sourceEvidence: { ...base.sourceEvidence, disposition: 'ROOT_PAGE' as const } })).toThrow(/requires INVALID_URL|requires NON_WEB_URL/u);
  });

  it('keeps provider identity when external IDs collide across complete lanes', () => {
    const anilist = createProviderCandidateEnvelope({ candidates: [{ externalId: '1', mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Anime'] }], complete: true, digest: 'digest-anilist', provider: 'anilist', truncated: false });
    const mangaUpdates = createProviderCandidateEnvelope({ candidates: [{ externalId: '1', mediaKind: 'MANGA', preSerialization: false, provider: 'mangaupdates', titles: ['Manga'] }], complete: true, digest: 'digest-manga', provider: 'mangaupdates', truncated: false });
    const references = [{ externalId: '1', provider: 'anilist' as const }, { externalId: '1', provider: 'mangaupdates' as const }];
    const decision = createResolutionDecision({ candidateReferences: references, kind: 'AMBIGUOUS', level: 'source-id', reasons: ['provider collision'] }, [anilist, mangaUpdates]);
    expect(decision.candidateReferences).toEqual(references);
    expect(() => createResolutionDecision({ candidateReferences: [], kind: 'NO_MATCH', level: 'source-id', reasons: ['duplicate lane'] }, [anilist, anilist])).toThrow(/one envelope per provider/u);
  });
});
