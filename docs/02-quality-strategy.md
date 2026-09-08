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
- An encrypted backup rejects tampering and a wrong passphrase without exposing
  plaintext or partially replacing local state.
- `npm run test:recovery` performs real WebCrypto AES-GCM/PBKDF2 round trips,
  asserts that private titles and the passphrase are absent from the serialized
  blob, proves zero replacements after wrong-passphrase and tamper failures,
  and verifies that the R2 adapter rejects plaintext before storage access.
- Every extension message and external payload is rejected on schema mismatch.
- WebBridge release packages must contain version `1.0.0`, the exact
  `https://tobirink.com/*` content-script match and the same
  `externally_connectable` match before their SHA-256 is recorded.
- Collective-index tests prove explicit consent, write/revoke credential
  separation, nonce replay rejection, daily quota enforcement and immediate
  revocation; fixtures assert that title, URL, library and progress fields fail.
- Public-catalogue tests prove that D1 stores only reconstructible work titles
  and provider references, rejects malformed limits and cursors, treats query
  values as bound data, and never exposes a private identifier or URL.
- Manifest permissions correspond to documented user flows. Host permissions
  match the documented exact provider and Worker origins; no domain wildcard
  or undocumented origin is accepted.
- The packaged-Chrome Playwright journey unpacks the produced `1.0.0` ZIP into
  an isolated profile, creates a synthetic bookmark through the real extension,
  proves Kitsu fallback after complete primary NO_MATCH and production WebBridge rendering, then
  reloads the private library offline without injecting a bridge mock.
- Logs and CI artifacts redact URLs, titles, identifiers, payload bodies, and
  secrets unless a field is explicitly classified as safe.
- Infrastructure `apply` refuses absent, stale, mismatched, or unapproved plans.
- `npm run test:infra` proves deterministic plan hashes, a 30-minute maximum
  lifetime, exact account/resource allowlists, state and preview drift refusal,
  D1-before-Worker ordering, and zero provider invocation for invalid actions.

## Performance budgets

- Local UI operations: visible response within 200 ms on the reference profile.
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
  identité, type, progression, décision et raison sans connexion, export ou
  donnée FavLib.
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
at import, NOT_FOUND actionability, human-only no-match, owner isolation,
distinct-owner confirmations, anti-replay batches, indexed SQL, MV3 checkpoints,
additive migrations and installed Chromium/Firefox evidence. The synthetic
clean-room corpus tests the reviewed behavior contract without depending on
FavLib data. Production readiness additionally requires installed-browser,
Worker/D1, recovery, security, quota and packaging evidence.

## Inherited tooling boundary

Sensor, CRG, CTXRoute, and Archify continue to validate repository governance.
They do not replace TypeScript, adapter, browser, migration, or Worker tests and
never become product runtime dependencies.
