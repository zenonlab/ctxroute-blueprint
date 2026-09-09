export type FavoriteEquivalenceDisposition = 'CONSERVER' | 'CORRIGER' | 'FUTUR';

export interface FavoriteEquivalenceManifestCase {
  readonly disposition: FavoriteEquivalenceDisposition;
  readonly expectedBehavior: string;
  readonly family: string;
  readonly id: string;
  readonly syntheticTitle: string;
  readonly syntheticUrl: string;
}

export interface FavoriteProviderEquivalenceFixture {
  readonly coverAttribution: string;
  readonly coverUrl: string;
  readonly externalId: string;
  readonly id: string;
  readonly mediaKind: 'ANIME' | 'MANGA' | 'MANHWA';
  readonly progress: Readonly<{ kind: 'chapter' | 'episode'; value: number }>;
  readonly provider: 'anilist' | 'kitsu-anime' | 'kitsu-manga' | 'mangadex' | 'mangaupdates';
  readonly title: string;
  readonly url: string;
}

export const favoriteProviderEquivalenceFixtures: readonly FavoriteProviderEquivalenceFixture[] = Object.freeze([
  Object.freeze({ coverAttribution: 'AniList', coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/fixture.jpg', externalId: '154587', id: 'provider-anilist', mediaKind: 'ANIME', progress: Object.freeze({ kind: 'episode' as const, value: 3 }), provider: 'anilist', title: 'Fixture Aurora Episode 3', url: 'https://fixtures.tobirink.invalid/anime/fixture-aurora/episode-3' }),
  Object.freeze({ coverAttribution: 'MangaUpdates', coverUrl: 'https://cdn.mangaupdates.com/image/fixture.jpg', externalId: '12345', id: 'provider-mangaupdates', mediaKind: 'MANHWA', progress: Object.freeze({ kind: 'chapter' as const, value: 12 }), provider: 'mangaupdates', title: 'Fixture River Chapter 12', url: 'https://fixtures.tobirink.invalid/manga/fixture-river/chapter-12' }),
  Object.freeze({ coverAttribution: 'MangaDex', coverUrl: 'https://uploads.mangadex.org/covers/12345678-1234-4234-8234-123456789abc/fixture.jpg.512.jpg', externalId: '12345678-1234-4234-8234-123456789abc', id: 'provider-mangadex', mediaKind: 'MANGA', progress: Object.freeze({ kind: 'chapter' as const, value: 8 }), provider: 'mangadex', title: 'Fixture Garden Chapter 8', url: 'https://fixtures.tobirink.invalid/manga/fixture-garden/chapter-8' }),
  Object.freeze({ coverAttribution: 'Kitsu', coverUrl: 'https://media.kitsu.app/anime/1/poster_image/large-fixture.jpeg', externalId: '1', id: 'provider-kitsu-anime', mediaKind: 'ANIME', progress: Object.freeze({ kind: 'episode' as const, value: 4 }), provider: 'kitsu-anime', title: 'Fixture Sky Episode 4', url: 'https://fixtures.tobirink.invalid/anime/fixture-sky/episode-4' }),
  Object.freeze({ coverAttribution: 'Kitsu', coverUrl: 'https://media.kitsu.app/manga/2/poster_image/large-fixture.jpeg', externalId: '2', id: 'provider-kitsu-manga', mediaKind: 'MANGA', progress: Object.freeze({ kind: 'chapter' as const, value: 9 }), provider: 'kitsu-manga', title: 'Fixture Paper Chapter 9', url: 'https://fixtures.tobirink.invalid/manga/fixture-paper/chapter-9' }),
]);

const definitions: readonly (readonly [id: string, expectedBehavior: string])[] = [
  ['P-01', 'same-normalized-key'], ['P-02', 'compact-key'], ['P-03', 'reordered-significant-words'], ['P-04', 'bounded-edit-distance'],
  ['P-05', 'ambiguous-same-level'], ['P-06', 'ignore-popularity'], ['P-07', 'no-prefix-match'], ['P-08', 'no-stemming-match'],
  ['L-01', 'single-strong-locale'], ['L-02', 'ambiguous-url-locales'], ['L-03', 'short-text-undetected'], ['L-04', 'statistical-over-weak'], ['L-05', 'strong-language-conflict'],
  ['F-01', 'symmetric-ova-compatibility'], ['F-02', 'symmetric-pre-serialization-compatibility'],
  ['C-01', 'exact-normalized-taxonomy-block'], ['C-02', 'no-substring-taxonomy-block'],
  ['X-01', 'reject-invalid-mangadex-uuid'], ['X-02', 'ignore-provider-progress'],
  ['U-01', 'category-path-identity'], ['U-02', 'generic-route-unknown-kind'], ['U-03', 'reject-numeric-slug'], ['U-04', 'official-provider-id'],
  ['U-05', 'separate-release-route'], ['U-06', 'attached-release-suffix'], ['U-07', 'path-over-hostname-kind'], ['U-08', 'exclude-utility-page'],
  ['U-09', 'exclude-unmarked-drama'], ['U-10', 'preserve-http-origin'],
  ['T-01', 'remove-reader-prefix'], ['T-02', 'guard-initial-track-badge'], ['T-03', 'separate-title-release'], ['T-04', 'language-number-is-release'],
  ['T-05', 'closed-marketing-suffix'], ['T-06', 'observed-hostname-suffix'], ['T-07', 'deduplicate-human-title'], ['T-08', 'preserve-unproven-track-word'],
  ['T-09', 'preserve-display-punctuation'], ['T-10', 'terminal-year-not-progress'],
  ['I-01', 'unique-aligned-human-title'], ['I-02', 'replace-opaque-slug'], ['I-03', 'block-uncorroborated-opaque-identity'],
  ['I-04', 'human-title-over-contradicted-prefix'], ['I-05', 'preserve-uncontradicted-prefix'], ['I-06', 'reject-release-alias'], ['I-07', 'missing-url-identity'],
  ['S-01', 'explicit-season'], ['S-02', 'ordinal-season'], ['S-03', 'bare-final-number-provenance'], ['S-04', 'explicit-url-season'],
  ['S-05', 'matching-season-evidence'], ['S-06', 'season-conflict'], ['S-07', 'season-without-progress'],
  ['R-01', 'explicit-integer-chapter'], ['R-02', 'localized-decimal-episode'], ['R-03', 'decimal-url-chapter'], ['R-04', 'last-equal-quality-marker'],
  ['R-05', 'marker-over-technical-id'], ['R-06', 'year-routing-id-not-progress'], ['R-07', 'numeric-url-without-identity'], ['R-08', 'numeric-url-with-identity'],
  ['R-09', 'adjacent-number-with-alias'], ['R-10', 'intrinsic-title-number'], ['R-11', 'extra-number-after-numeric-identity'], ['R-12', 'ordinal-remains-identity'],
  ['R-13', 'season-number-not-release'], ['R-14', 'season-conflict-keeps-local-release'],
  ['Q-01', 'idempotent-enqueue'], ['Q-02', 'new-fingerprint-new-task'], ['Q-03', 'concurrent-enqueue-converges'], ['Q-04', 'resume-every-checkpoint'],
  ['Q-05', 'expired-claim-same-idempotency'], ['Q-06', 'persist-provider-retry-date'], ['Q-07', 'hydrate-by-exact-id'], ['Q-08', 'consent-removal-blocks'],
  ['B-01', 'sliced-install-inventory'], ['B-02', 'idempotent-bookmark-events'], ['B-03', 'bookmark-delete-preserves-work'], ['B-04', 'empty-inventory-success'],
  ['B-05', 'scan-failure-preserves-projection'], ['O-01', 'deep-synthetic-oracle'], ['O-02', 'reject-private-corpus'],
];

const correctionIds = new Set(['U-02', 'U-10', 'B-03', 'O-02']);
const canonicalIds = new Set(definitions.map(([id]) => id));

function dispositionFor(id: string): FavoriteEquivalenceDisposition {
  if (id === 'X-01') return 'FUTUR';
  if (correctionIds.has(id)) return 'CORRIGER';
  return 'CONSERVER';
}

export const favoriteEquivalenceCorpus: readonly FavoriteEquivalenceManifestCase[] = Object.freeze(definitions.map(([id, expectedBehavior]) => Object.freeze({
  disposition: dispositionFor(id),
  expectedBehavior,
  family: id.slice(0, 1),
  id,
  syntheticTitle: `Fixture ${id}`,
  syntheticUrl: `https://fixtures.tobirink.invalid/${id.toLowerCase()}`,
})));

export interface FavoriteEquivalenceCorpusAudit {
  readonly conserved: number;
  readonly corrected: number;
  readonly future: number;
  readonly total: number;
}

export function auditFavoriteEquivalenceCorpus(corpus: readonly FavoriteEquivalenceManifestCase[] = favoriteEquivalenceCorpus): FavoriteEquivalenceCorpusAudit {
  const ids = new Set(corpus.map((item) => item.id));
  if (ids.size !== corpus.length) throw new Error('Favorite equivalence case IDs must be unique.');
  if (corpus.some((item) => !/^[A-Z]-\d{2}$/u.test(item.id))) throw new Error('Favorite equivalence case IDs must follow the canonical family format.');
  if (corpus.some((item) => !canonicalIds.has(item.id)) || [...canonicalIds].some((id) => !ids.has(id))) throw new Error('Favorite equivalence corpus must contain every canonical case ID exactly once.');
  if (corpus.some((item) => item.disposition !== dispositionFor(item.id))) throw new Error('Favorite equivalence dispositions must match the audited case IDs.');
  if (corpus.some((item) => item.syntheticTitle !== `Fixture ${item.id}`)) throw new Error('Favorite equivalence fixtures must use synthetic labels.');
  if (corpus.some((item) => !item.syntheticUrl.endsWith(`/${item.id.toLowerCase()}`) || !item.syntheticUrl.startsWith('https://fixtures.tobirink.invalid/'))) throw new Error('Favorite equivalence fixtures must use the reserved synthetic origin.');
  const audit = Object.freeze({
    conserved: corpus.filter((item) => item.disposition === 'CONSERVER').length,
    corrected: corpus.filter((item) => item.disposition === 'CORRIGER').length,
    future: corpus.filter((item) => item.disposition === 'FUTUR').length,
    total: corpus.length,
  });
  if (audit.total !== 82 || audit.conserved !== 77 || audit.corrected !== 4 || audit.future !== 1) throw new Error('Favorite equivalence corpus must remain 82 / 77 / 4 / 1.');
  return audit;
}
