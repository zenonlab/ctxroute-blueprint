# Project brief

## Summary

- Name: Tobirink.
- Problem solved: keep a personal manga and anime library, reading progress,
  agenda, reminders, and browser-assisted discovery coherent without making a
  cloud account the source of truth.
- Users: one reader first; maintainers operate releases and the optional public
  service.
- In scope: a Chromium/Firefox extension, local library and progress, bookmarks
  as authority for presence and observed progress, agenda and notifications, a reconstructible
  public catalogue, optimized cover delivery, and optional encrypted recovery.
- Out of scope for v1: accounts, private library synchronization, payments,
  social graph, general-purpose web application, general-purpose microservices, and
  reuse of FavLib source code.
- Product shape: local-first WebExtension, a static Next App Router export for
  public catalogue and connected local projections, and an optional edge API.
  The site is not a general-purpose web application and has no account,
  authentication, private storage access, Review route, or radio surface.
- Local release candidate: `1.0.45`; the extension package sets WXT manifests
  and local ZIP names. The independently controlled public download pointer
  remains `1.0.44` until the candidate's immutable archives are published and verified.

## Discovery context

- Expected usage and traffic: initially single-user local workloads; the public
  API must scale horizontally but remains optional and non-blocking.
- Data and lifecycle: browser bookmarks own presence and observed progress;
  IndexedDB owns private transactional artifacts, works, decisions, projected
  agenda and tasks. D1 owns the shared public catalogue: canonical identities,
  titles, provider references and one current metadata projection per work.
  That projection distinguishes announced totals, last confirmed release and
  the compact Agenda model; aliases reference it instead of duplicating a
  profile. R2 owns bounded operational requests, checkpoints, leases and at
  most twelve release observations per work, in addition to rights-approved
  cover masters and encrypted recovery blobs. Neither store receives an owner,
  installation identity, private decision or progress.
- Integrations: WebExtension active-tab context, bookmarks, alarms,
  notifications, storage and messaging APIs; browser sync for a bounded
  snapshot of provider IDs only;
  optional Cloudflare Workers, D1, R2 and Images through owned adapters.
- Team and ownership: one product owner authorizes bounded autonomous plans;
  agents implement, verify, document, commit and push the approved work.
  Destructive operations and direct production mutations require immediate
  confirmation of their exact targets.
- Risk and compliance: browsing history, library content, and progress are
  private. No remote telemetry or private-data upload is enabled by default.
- Deployment environments: unpacked extension in development, deterministic
  Chrome/Firefox ZIPs installed manually, and an optional Cloudflare edge
  environment. Store signing and automatic updates are not certified.
- Expected change: browser capabilities, content-source integrations, storage
  implementations, and cloud providers are the most volatile boundaries.

## Constraints

- Performance: extension UI interactive within 200 ms for local operations;
  the library filters and sorts a transactional snapshot of at most 500 works
  before paginating 24 visible results; background startup performs no unbounded scan; normal extension bundle target
  is below 1.5 MB compressed; public API p95 target is below 300 ms excluding
  third-party calls.
- Security: least-privilege manifest permissions, strict CSP, no remotely hosted
  extension code, validated messages and API payloads, no product owner secret,
  and no sensitive values in logs.
- Reliability: local features work offline; migrations are atomic and tested;
  export/import is the v1 recovery path; cloud failures degrade only optional
  public features.
- Platform: current stable Chrome and Firefox; TypeScript strict mode on Node.js
  24 LTS for product tooling. The inherited control plane keeps its Node 22.13+
  compatibility floor until a separately approved migration.
- Delivery: deterministic browser packages, manual installation preserving the
  browser profile, protected autonomous Worker delivery from `main`, the existing
  Deno GitHub App, and rollback to the prior extension package or Worker version.

## Inherited governance baseline

The blueprint supplies repository governance, CTXRoute context routing,
official code-review-graph v2.3.8, Archify documentation validation, and a
separate Sensor for static diagnostics. Sensor language packs are exact,
project-local dependencies; setup synchronizes declared packs, while hooks and
analysis never install from the network. Tooling requires Git, Node.js 22.13+,
npm 10+, Python 3.10+, and uv 0.11.2; Python 3.12 is the reference CRG runtime.
These tools govern the repository and stay outside product diagrams. They do
not become runtime dependencies of Tobirink.

## Decisions

- Language: TypeScript in strict mode to share contracts across extension and
  optional Worker while keeping provider boundaries explicit.
- Runtime: browser Manifest V3 service worker and pages; Node.js 24 LTS for
  product build/test; a Cloudflare Worker with Queue/Cron for public capabilities;
  an isolated Deno Deploy gateway only for provider endpoints blocked from
  Cloudflare egress.
- Frontend: React 19 inside WXT entrypoints and a static Next App Router site,
  with CSS Modules and the existing framework-neutral design contract. The
  site is exported and served by the Worker with an explicit route fallback;
  it is not a server-centred application.
- Backend: one Hono Worker owns the public HTTP surface, D1 and Queue consumers.
  A separate HMAC-authenticated Deno gateway forwards only allowlisted AniList
  and MangaUpdates requests; MangaDex and Kitsu remain direct from Cloudflare.
  Rails is not selected for v1 because authoritative member workflows are local.
- Storage: Dexie-backed IndexedDB behind `StoragePort`; `storage.local` only for
  bootstrap, technical preferences and a five-entry, thirty-day, non-authoritative
  popup continuation cache; `storage.sync` only for a bounded
  provider-ID snapshot; D1 for canonical public catalogue rows, their current
  metadata and compact release models; R2 for bounded collection state,
  prediction observations, image objects and encrypted backup blobs. A Queue
  signal references recoverable R2 work and only the native consumer may
  publish a verified D1 revision.
  Domain code cannot import any provider.
- Library analytics: seven stable multi-select facets (genre, editorial status,
  detailed type, format, year, personal progress and provider) and six sorts
  run in the extension. Facet options come from the complete bounded local
  corpus, remain mounted while a selection changes and never become collective
  data.
- Tests: Vitest for domain and contracts, Vitest Browser Mode for UI, Playwright
  for Chromium extension journeys, Firefox packaging smoke with `web-ext`, and
  Workers integration tests in `workerd`.
- Deployment: WXT-generated browser artifacts with a separate public version
  pointer; GitHub Actions verifies the repository then inspects, plans and
  applies the exact Worker target. Deno uses its existing GitHub App only.
  R2 publication, secrets, billing, permissions and direct data mutations are
  outside that automatic Worker lane and require their own confirmed plan.
- WebBridge delivery: release packaging pins the exact non-secret site origin
  `https://tobirink.com` into both manifests and refuses an origin or version
  mismatch before producing an archive.
- Observability: a `TelemetryPort`, bounded redacted local diagnostics,
  structured Queue logs containing lane, attempt and disposition, Workers Logs
  and traces for the public service, and bounded Deno request metadata; remote
  extension telemetry is off by default.
- Security: explicit trust boundaries, permission budget, schema validation,
  adapter contract tests, dependency audit, and threat-model review.
- Performance: enforce the budgets above in build reports, browser journeys,
  and Worker tests before release.
- Public refresh: unknown works are resolved on demand; known active works are
  refreshed once per week per canonical identity. Completed works have no
  periodic release collection. Provider relations never enqueue seasons,
  sequels or adaptations; exact references that identify the same work remain
  available for deduplication.
- Agenda: the server persists a finite model per work, never a row per future
  occurrence. An explicit AniList date wins over prediction. Otherwise the
  existing bounded manga predictor may expose only the next expected civil
  date. Time passing is projected locally and performs no remote write.
- Classification: exact, versioned provider signals produce `adult`,
  `non-adult` or `unknown`. With adult content hidden, only explicit `adult`
  records are excluded; `unknown` remains visible and is never recorded as
  proof of non-adult content.

## Clean-room and cutover boundary

FavLib remains an intact functional reference and rollback artifact only.
TobiRink starts with a new extension identity, a new IndexedDB name, and new
Cloudflare resource names. Product runtime never reads, migrates, or reuses FavLib local databases,
identifiers, D1 bindings, R2 buckets, or private projections. Validation never
connects to a FavLib database or consumes a FavLib export. Historical behavior
is represented only by reviewed, synthetic clean-room fixtures; private rows
never enter Git, logs, CI or shared test artifacts.
Existing browser HTTP(S) bookmarks may be imported as fresh sources on first
launch. Preview, cutover, and rollback keep the two products isolated; a
rollback restores the previous site or Worker artifact without converting or
deleting the new local database.

See [`docs/01-technology-decisions.md`](01-technology-decisions.md) for the
questions, trade-offs, and research anchors used to make these decisions.

## Success criteria

- A user can manage library entries and progress offline across supported
  extension views without contacting a remote service.
- Browser and provider code cannot cross the declared import boundaries; all
  external payloads and extension messages are validated.
- Une résolution consulte D1 avant toute recherche textuelle. Un seul client
  obtient un bail; sa proposition contient uniquement empreinte versionnée et
  identifiants publics, puis seul le collecteur Queue natif peut publier
  `VERIFIED`. Aucun consentement produit, owner, appairage, titre brut, URL,
  bibliothèque ou progression n’entre dans ce protocole.
- Storage migration, export, import, cache reconstruction, encrypted recovery,
  extension rollback, and optional Worker rollback have executable verification
  before a release.
- Product architecture validates at Archify showcase quality and the agreed
  unit, integration, browser, security, and performance gates pass.
- An unchanged weekly collection writes neither titles, references, canonical
  metadata nor Agenda models; a changed counter updates one canonical work and
  is visible through every alias.
