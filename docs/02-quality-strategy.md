# Quality strategy

Quality protects the local-first privacy boundary, cross-browser packaging,
data migrations, and replaceable provider adapters. A gate becomes executable
in the same approved step that introduces its corresponding product surface.

## Test matrix

| Type | Requirement | Scope | Target evidence |
| --- | --- | --- | --- |
| Unit | required | Domain entities, use cases, schemas, migrations, and pure adapters | Vitest; 90% lines/functions and 80% branches for domain/application packages |
| Static | required | Strict TypeScript, lint, anti-slop, and dependency direction | Typecheck, lint, Sensor, and dependency-cruiser pass |
| Contract | required | Storage, browser, messaging, public-data, telemetry, import/export, and provider gates | The same contract suite passes against fakes and every real adapter |
| UI | required | React components and extension documents | Vitest Browser Mode with interaction and accessibility assertions |
| Static web UI | required | Workbench routes, bridge states, URL filters, weekly rail and secondary pages | Vitest/jsdom plus Playwright at 1440×900 and 390×844 against the static export |
| Extension E2E | required | Install, library update, progress, background wake-up, permissions, and recovery | Playwright Chromium journeys plus Firefox `web-ext` smoke |
| Worker integration | required | Hono routes, D1 repository, prepared queries, pagination, validation, errors, and redaction | Cloudflare Vitest pool running in `workerd` against every migration |
| Migration / recovery | required | IndexedDB upgrade, export/import, fragmented provider-ID sync snapshot, encrypted backup, interrupted operation, and rollback compatibility | Fixture matrix for every supported schema version |
| Media pipeline | conditional | Rights policy, image decoding, normalization, fixed variants, quantization, object keys, and cache policy | Malformed-image fixtures, visual regression samples, metadata inspection, and R2 orphan audit |
| Security | required | Permission budget, CSP, messages, imports, HTTP inputs, secrets, and dependencies | Threat-model review, negative fixtures, audit, and package inspection |
| Accessibility | required | Keyboard, focus, names, contrast, reduced motion, zoom, and screen-reader semantics | Automated checks plus manual release review |
| Performance | required | UI response, background startup, bundle size, and optional API latency | Budget report and representative browser/Worker tests |

## Product release gate

No release may weaken a required gate without an ADR and explicit approval.
Flaky tests are defects, not accepted retries. Tests use synthetic libraries and
isolated browser profiles; real browsing history, credentials, and private user
data are forbidden in fixtures and artifacts.

The inherited `npm run validate` remains mandatory. Product commands will be
added to the root gate only when they exist and have a stable local contract.
The repository currently relies on verified local commit and push gates; no
GitHub Actions workflow is an active source of release evidence.

## Decision rule

Pure domain behavior uses fast deterministic unit tests. Every boundary adds a
contract test. Browser semantics add a real extension journey. Persistence
changes add forward migration, export/import, and failure recovery fixtures.
Provider changes add adapter contract tests and a dry-run plan. Public or
untrusted inputs add negative security tests.

Required checks must expose a root command, deterministic threshold, bounded
output, and sanitized CI evidence. A test framework cannot replace a real
browser or `workerd` test when platform behavior is the risk.

## Security and privacy assertions

- The extension operates without the public API.
- Provider requests contain only the parsed title or explicit provider ID;
  fixtures reject raw URLs, folders, progress, library and history fields.
- Browser bookmarks own presence and observed progress; IndexedDB owns private
  transactions. Removal detaches a source without deleting historical data.
- `storage.sync` contains only provider IDs and manifests; quotas include old
  generations, keys and metadata. Corruption/interruption retains the last
  validated snapshot. Chrome and Firefox reset journeys must pass.
- Library message tests reject unbounded offsets and more than 64 selections
  per facet. Catalogue tests prove OR semantics inside one facet, AND semantics
  between facets, exclusion priority, filtering before pagination and options
  computed from the unchanged bounded corpus.
- DOM interaction tests cycle include, exclude and neutral facet states without
  closing the menu, restore focus on Escape and reject a delayed pagination
  response after the query changes.
- Provider provenance, format, genres, status, years, totals, typed popularity,
  filters and derived statistics stay in IndexedDB and extension messages.
  Sync and public-discovery payload fixtures reject these fields; no synopsis,
  description or other editorial prose is collected.
- MangaDex tests admit only tags whose declared group is `genre` into the genre
  facet. MangaDex last chapter/volume and MangaUpdates latest chapter remain
  observations and never become editorial totals.
- An encrypted backup rejects tampering and a wrong passphrase without exposing
  plaintext or partially replacing local state.
- `npm run test:recovery` performs real WebCrypto AES-GCM/PBKDF2 round trips,
  asserts that private titles and the passphrase are absent from the serialized
  blob, proves zero replacements after wrong-passphrase and tamper failures,
  and verifies that the R2 adapter rejects plaintext before storage access.
- Every extension message and external payload is rejected on schema mismatch.
- WebBridge release packages must contain the current candidate version `1.0.31`, the exact
  `https://tobirink.com/*` content-script match and the same
  `externally_connectable` match before their SHA-256 is recorded.
- Public Discovery tests prouvent la création D1 atomique et dédupliquée,
  l’attente sans consommation de tentative MV3, le claim natif via Queue,
  la publication terminale d’un profil complet et son rejeu idempotent.
  Les contrats refusent une cinquième entrée dans chacune des deux listes de
  titres. Les tests D1 réels vérifient le plafond global actif et sa réponse
  `503`, l’expurgation terminale et le backfill historique de `request_json`
  sans altérer les demandes reprenables, les échéances des nonces et
  des échecs, l’index canonique versionné, son plan de requête et le rejet sans
  écriture partielle d’une collision de titre normalisé.
  Les tests du runner prouvent qu’un MISS, un PENDING et un VERIFIED ne lancent
  aucune recherche ou hydratation fournisseur dans la découverte automatique
  de l’extension.
  Le package exportable exécute en plus les tests HTTP réels des cinq
  adaptateurs, vérifie les deux ordres de fallback et l’ambiguïté inter-lanes,
  refuse tout import `@tobirink/*` et produit son bundle depuis son propre
  manifeste et son propre lockfile. Les tests Worker exigent que les anciennes
  routes externes de claim, résultat et ingestion Agenda répondent 410.
  Les anciennes routes de consentement, d’appairage et de cache non vérifié
  doivent répondre 404.
- Public-catalogue tests prove that D1 stores only reconstructible work titles
  and provider references, rejects malformed limits and cursors, treats query
  values as bound data, and never exposes a private identifier or URL.
- Manifest permissions correspond to documented user flows. The only host
  permission is the configured TobiRink origin; no provider origin, domain
  wildcard, DNR ruleset or undocumented origin is accepted.
- The packaged-Chrome Playwright journey unpacks the produced `1.0.31` ZIP into
  an isolated profile, creates a synthetic bookmark through the real extension,
  proves Public Discovery cache-first resolution and production WebBridge rendering, then
  reloads the private library offline without injecting a bridge mock.
- Logs and CI artifacts redact URLs, titles, identifiers, payload bodies, and
  secrets unless a field is explicitly classified as safe.
- Infrastructure `apply` refuses absent, stale, mismatched, or unapproved plans.
- `npm run test:infra` proves deterministic plan hashes, a 30-minute maximum
  lifetime, exact account/resource allowlists, state and preview drift refusal,
  D1-before-Worker ordering, and zero provider invocation for invalid actions.
- Native collector tests require structured, payload-free diagnostics for
  invalid signals, successful acknowledgement, bounded retry and the final
  retry that Cloudflare transfers to the configured DLQ. Agenda failures retain
  only the bounded `anilist`, `mangaupdates` or combined lane code.
- The Deno gateway health contract is HTTP 200 with
  `{ "status": "healthy" }`; error responses retain `{ "error": code }`.
- Gateway rotation tests admit exactly one distinct previous HMAC key, reject
  weak, duplicate and excessive key sets, preserve nonce replay protection and
  prove that the Deno gate redacts both values while inspecting only secret
  names.

## Performance budgets

- Local UI operations: visible response within 200 ms on the reference profile.
- Library reads use one IndexedDB transaction, inspect at most 500 work IDs,
  expose at most 64 values per facet and return at most 24 cards. Missing and
  cross-provider popularity values sort after the selected comparable provider
  cohort with a stable title/ID tie-breaker.
- The Chromium storage contract materializes 500 real Dexie works, filters the
  complete corpus before a 24-card page, checks the 64 KiB response ceiling and
  enforces the 200 ms local-read budget. Three validation runs on the reference
  profile measured 34.70–37.70 ms.
- Background startup: no unbounded scan and no network dependency.
- Parser favori local : p95 inférieur à 10 ms pour une entrée typique et à
  50 ms pour une entrée Unicode proche de la borne, mesuré sans réseau.
  Baseline locale du 2026-09-07 : 0,124 ms typique et 0,852 ms maximal sur
  200/50 itérations; la CI republie les valeurs au lieu de les arrondir.
- Le snapshot canonique des favoris garde la forme profonde; le gate
  `test:parser-equivalence` exige en plus un test sémantique exécuté pour chacun
  des 82 identifiants, vérifie l’unicité de leurs attentes et maintient le bilan
  historique 77 conservés / 4 corrigés / `X-01` futur comme référence initiale.
  Le plan v3 active X-01 MangaDex. Le corpus clean-room couvre explicitement
  identité, type, progression, décision et raison sans export ou donnée FavLib.
  Lorsque le checkout voisin est disponible, un différentiel exécute en mémoire
  le parseur FavLib `3267de2` au digest épinglé et classe chaque écart synthétique.

## Dependency integrity

- A clean npm installation applies the version-bound Miniflare patch before
  validation. `npm ls sharp --all` must resolve 0.35.4 without invalid edges.
- `npm audit --audit-level=high`, Worker tests, Oxlint and both browser builds
  run from that clean tree. Darwin native entries must not carry Linux `libc`
  selectors in the lockfile.
- Extension package: target below 1.5 MB compressed, with approved exceptions.
- Public API: p95 below 300 ms excluding third-party latency, with a bounded
  timeout and explicit unavailable result.
- Every hot D1 query uses bound parameters, a bounded projection, cursor-based
  pagination where applicable, and a reviewed `EXPLAIN QUERY PLAN`. CI records
  `rows_read` and `rows_returned`; a material regression blocks release.
- `npm run test:d1` verifies the catalogue migration, 50/100 page bounds,
  `(revision, work_id)` cursor, fixed related-row limits, cache policy, and the
  query plans for incremental and reverse-reference lookups in `workerd`.
- Cover delivery exposes only `cover-sm` (96 x 144), `cover-md` (192 x 288),
  and `cover-lg` (384 x 576). It never upscales or crops source art.
- Continuous-tone covers use negotiated AVIF/WebP quality settings. Palette
  quantization is allowed only for visually verified flat PNG artwork.
- Media tests enforce bounded input dimensions and bytes, orientation and color
  normalization, sensitive-metadata removal, immutable content-addressed keys,
  fixed transformation parameters, and expected cache headers.
- `npm run test:media` verifies rights-first R2 ingestion, idempotent conditional
  writes, the exact three-name variant map, `scale-down`, rejection of query
  parameters, content negotiation, immutable caching, conditional GET, and the
  missing-master path without using a remote bucket or Images service.
- `npm run test:agenda` combines the existing reminder tests with public
  snapshot adapter and Worker tests. It proves strict public fields, stable
  ordering, duplicate rejection, caller-independent output, bounded R2 reads,
  conditional caching and fallback to the last validated local snapshot.

## Favorite correction acceptance

The [v3 plan](systems/favorite-resolution-correction-plan.md) adds zero Review
at import, NOT_FOUND actionability, human-only no-match, indexed SQL, MV3
checkpoints, additive migrations and installed Chromium/Firefox evidence. Le
cache public actuel remplace l’ancien modèle owner par
`MISS/PENDING/PROCESSING/VERIFIED/NOT_FOUND/AMBIGUOUS` : une demande D1 unique,
aucune recherche après une issue terminale, et seule une reprise de claim
collecteur abandonné peut répéter le travail. The synthetic clean-room
corpus tests the reviewed behavior contract without depending on FavLib data.

## Inherited tooling boundary

Sensor, CRG, CTXRoute, and Archify continue to validate repository governance.
They do not replace TypeScript, adapter, browser, migration, or Worker tests and
never become product runtime dependencies.
