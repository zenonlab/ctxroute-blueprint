import { createFavoriteObservation, createSourceEvidence } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { parseFavoriteObservation } from './favorite-parser';
import { extractFavoriteSourceEvidence } from './source-evidence';

const observation = (title: string, url = 'https://fixtures.tobirink.invalid/anime/work') => createFavoriteObservation({ bookmarkId: 'parser', folderPath: [], observationRevision: 'r1', observationSequence: 1, observedAt: '2026-09-07T10:00:00.000Z', presence: 'observed', siblingOrder: 0, title, url });
const evidence = (values = {}) => createSourceEvidence({ aliases: [], diagnostics: [], key: 'parser', mediaKind: 'ANIME', origin: 'https://fixtures.tobirink.invalid', path: '/anime/work', proofs: ['TITLE_SLUG'], sourceAdapter: 'fixture', strategy: 'generic', ...values });

describe('favorite identity parser I-01…I-07', () => {
  it('I-01 aligns routing, language and reader decorations', () => expect(parseFavoriteObservation(observation('Frieren [reader]'), evidence({ rawSlug: '123-vostfr-frieren-reader', stableSlug: '123-vostfr-frieren-reader' }))).toMatchObject({ identityKey: 'frieren', status: 'parsed' }));
  it('I-02 replaces an opaque slug with one human title', () => expect(parseFavoriteObservation(observation('Frieren'), evidence({ rawSlug: '9f3a8c21', stableSlug: '9f3a8c21' }))).toMatchObject({ identityKey: 'frieren', transformations: ['opaque-url-slug-replaced'] }));
  it('I-02 replaces a prefixed mixed opaque slug while preserving intrinsic title numbers', () => {
    expect(parseFavoriteObservation(observation('Synthetic Ember Ledger'), evidence({ rawSlug: 'route-zx731904', stableSlug: 'route-zx731904' }))).toMatchObject({ displayTitle: 'Synthetic Ember Ledger', identityKey: 'synthetic ember ledger', transformations: ['opaque-url-slug-replaced'] });
    expect(parseFavoriteObservation(observation('Area 51'), evidence({ rawSlug: 'area-51', stableSlug: 'area-51' }))).toMatchObject({ displayTitle: 'area 51', identityKey: 'area 51' });
  });
  it('I-03 blocks an uncorroborated opaque identity', () => expect(parseFavoriteObservation(observation('9f3a8c21'), evidence({ rawSlug: '9f3a8c21', stableSlug: '9f3a8c21' }))).toMatchObject({ diagnostics: ['OPAQUE_IDENTITY_UNCORROBORATED'], status: 'identity-missing' }));
  it('I-04 removes a contradicted numeric prefix', () => expect(parseFavoriteObservation(observation('Frieren'), evidence({ stableSlug: '123-frieren' })).identityKey).toBe('frieren'));
  it('I-05 preserves an uncontradicted numeric prefix', () => expect(parseFavoriteObservation(observation('86 Eighty Six'), evidence({ stableSlug: '86-eighty-six' })).identityKey).toBe('86 eighty six'));
  it('I-06 excludes release-bearing aliases', () => expect(parseFavoriteObservation(observation('Frieren chapter 1'), evidence({ stableSlug: 'frieren-chapter-1' })).aliases?.every((alias) => !/chapter/iu.test(alias.value))).toBe(true));
  it('I-07 records missing URL identity and keeps raw input', () => { const rejected = createSourceEvidence({ aliases: [], diagnostics: [], disposition: 'ROOT_PAGE', key: 'parser', mediaKind: 'UNKNOWN', proofs: [], sourceAdapter: 'fixture', strategy: 'generic' }); const artifact = parseFavoriteObservation(observation('Frieren'), rejected); expect(artifact).toMatchObject({ diagnostics: ['URL_IDENTITY_MISSING'], raw: { title: 'Frieren' }, status: 'identity-missing' }); });
  it('records a structural routing suffix without exposing it as identity', () => expect(parseFavoriteObservation(
    observation('kage no jitsuryokusha ni naritakute 006'),
    evidence({ identityTransformations: ['numeric-routing-suffix'], mediaKind: 'MANHWA', rawSlug: 'kage-no-jitsuryokusha-ni-naritakute-006', release: { kind: 'chapter', provenance: 'URL_PATH', raw: 'chapter-66.1', value: 66.1 }, stableSlug: 'kage-no-jitsuryokusha-ni-naritakute' }),
  )).toMatchObject({ displayTitle: 'kage no jitsuryokusha ni naritakute', identityKey: 'kage no jitsuryokusha ni naritakute', progress: { kind: 'chapter', value: 66.1 }, transformations: ['numeric-routing-suffix'] }));
  it('removes an attached routing prefix from every provider-facing alias', () => expect(parseFavoriteObservation(
    observation('0906168628 Genius of the Unique Lineage'),
    evidence({ identityTransformations: ['numeric-routing-prefix'], mediaKind: 'UNKNOWN', rawSlug: '0906168628-genius-of-the-unique-lineage-chapter-31', release: { kind: 'chapter', provenance: 'URL_SLUG_SUFFIX', raw: 'chapter-31', value: 31 }, releaseSuffix: 'chapter-31', stableSlug: 'genius-of-the-unique-lineage' }),
  )).toMatchObject({ aliases: [{ provenance: 'stable-url-slug', value: 'Genius of the Unique Lineage' }], displayTitle: 'Genius of the Unique Lineage', identityKey: 'genius of the unique lineage', progress: { kind: 'chapter', value: 31 }, transformations: ['numeric-routing-prefix'] }));
  it.each([
    ['Chapitre 51 | The Hero Returns | LegacyScans', 'the-hero-returns', 'The Hero Returns', 'the hero returns'],
    ['A Wannabe Golden Gangster | Special Episode 2 [END] | Read Free Manga Online', 'a-wannabe-golden-gangster', 'A Wannabe Golden Gangster', 'a wannabe golden gangster'],
    ['Artifact Reading Appraiser | Chapter 18 | Void Scans', 'artifact-reading-appraiser', 'Artifact Reading Appraiser', 'artifact reading appraiser'],
  ])('uses the unique bookmark segment aligned with the source slug: %s', (title, stableSlug, displayTitle, identityKey) => {
    expect(parseFavoriteObservation(observation(title), evidence({ mediaKind: 'MANGA', rawSlug: stableSlug, stableSlug }))).toMatchObject({ displayTitle, identityKey });
  });
  it('removes a corroborated long routing prefix without a site-specific title rule', () => expect(parseFavoriteObservation(
    observation('1674484774 Skeleton Soldier Couldnt Protect the Dungeon'),
    evidence({ identityTransformations: ['numeric-routing-prefix'], mediaKind: 'MANGA', rawSlug: '1674484774-skeleton-soldier-couldnt-protect-the-dungeon', release: { kind: 'chapter', provenance: 'URL_PATH', raw: 'chapter-51', value: 51 }, stableSlug: 'skeleton-soldier-couldnt-protect-the-dungeon' }),
  )).toMatchObject({ displayTitle: 'Skeleton Soldier Couldnt Protect the Dungeon', identityKey: 'skeleton soldier couldnt protect the dungeon', progress: { kind: 'chapter', value: 51 } }));
  it('keeps the inferred URL title clean in the complete Bato flow', () => {
    const title = 'A Wannabe Golden Gangster | Special Episode 2 [END] | Read Free Manga Online';
    const url = 'https://bato.si/title/141645-en-a-wannabe-golden-gangster/3083720-ch_67';
    const artifact = parseFavoriteObservation(observation(title, url), extractFavoriteSourceEvidence({ sourceKey: 'parser', title, url }));
    expect(artifact).toMatchObject({ displayTitle: 'A Wannabe Golden Gangster', identityKey: 'a wannabe golden gangster', status: 'parsed' });
  });
  it('preserves a complete parenthesized title and records bounded alias provenance', () => expect(parseFavoriteObservation(
    observation('Existence (Wangho)'), evidence({ mediaKind: 'MANGA', rawSlug: 'existence-wangho', stableSlug: 'existence-wangho' }),
  )).toMatchObject({
    displayTitle: 'Existence (Wangho)', parserVersion: 'favorite-parser-v5', matcherVersion: 'favorite-matcher-v4',
    aliases: expect.arrayContaining([
      { provenance: 'parenthesized-base', value: 'Existence' },
      { provenance: 'parenthesized-alternate', value: 'Wangho' },
    ]),
  }));
  it.each(['Existence (2024)', 'Existence (OVA)', 'Existence (Novel)', 'Existence ((Wangho))'])('does not create identity aliases from qualifier %s', (title) => {
    const artifact = parseFavoriteObservation(observation(title), evidence({ mediaKind: 'MANGA', rawSlug: title.toLowerCase().replace(/[^a-z0-9]+/gu, '-'), stableSlug: title.toLowerCase().replace(/[^a-z0-9]+/gu, '-') }));
    expect(artifact.aliases?.some((alias) => alias.provenance.startsWith('parenthesized-'))).toBe(false);
  });
  it('does not select one unrelated human segment for an opaque source slug', () => expect(parseFavoriteObservation(
    observation('First Candidate | Second Candidate'), evidence({ rawSlug: 'route-zx731904', stableSlug: 'route-zx731904' }),
  )).toMatchObject({ diagnostics: ['OPAQUE_IDENTITY_UNCORROBORATED'], status: 'identity-missing' }));
  it('is deeply deterministic and immutable', () => { const first = parseFavoriteObservation(observation('Frieren'), evidence({ stableSlug: 'frieren' })); const second = parseFavoriteObservation(observation('Frieren'), evidence({ stableSlug: 'frieren' })); expect(first).toEqual(second); expect(Object.isFrozen(first)).toBe(true); expect(Object.isFrozen(first.segments)).toBe(true); });
});
