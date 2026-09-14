# Technology decisions

## Product evidence

FavLib is a functional reference only. Tobirink is a clean-room rewrite: no
source file, package structure, migration, or implementation is copied. The
product is extension-first, private data is local-first, remote capabilities
are optional, and infrastructure providers must remain replaceable.

## Blueprint tooling decision

The template control plane uses Node.js 22.13+ and npm 10+. Official
code-review-graph v2.3.8 runs from a frozen uv 0.11.2 project with Python 3.12
as the reference and Python 3.10+ as the supported floor. CTXRoute is the sole
hook orchestrator; CRG is the code-context MCP, while the independent
Tree-sitter registry remains Sensor-only. Archify v2.16.0 owns executable
architecture evidence and desktop visual containment checks.

Miniflare 5.20260903.0-alpha declares vulnerable `sharp@0.35.2` exactly while
the compatible patched release is 0.35.4. The root resolution installs 0.35.4
and a version-bound `patch-package` receipt updates only Miniflare's dependency
declaration after installation. The same reviewed one-line correction is
recorded on Miniflare's lockfile edge so npm can validate the realized tree. A
changed Miniflare manifest fails the patch;
`npm ls sharp --all`, Worker tests and browser builds then guard compatibility.
Lockfile validation also rejects impossible `libc` selectors on Darwin native
packages; those selectors prevent clean installs from restoring Lightning CSS
and Oxlint binaries.

## Selected stack

| Topic | Decision | Why | Replacement boundary |
| --- | --- | --- | --- |
| Language | TypeScript strict | One contract language for extension, tests, and Worker; first-class browser ecosystem | Domain has no framework imports |
| Workspace | npm workspaces on Node.js 24 LTS | Boring, native monorepo support and current LTS | Root commands are the public interface |
| Extension | WXT 0.21.x, exact pin | MV3, Chrome/Firefox targets, entrypoint conventions, packaging and publishing helpers | WXT exists only in `apps/extension` and implements browser ports |
| UI | React 19 and CSS Modules | Mature component/testing ecosystem with minimal styling runtime | UI depends on application use cases, not provider SDKs |
| Private authority | Bookmarks plus IndexedDB through Dexie | Browser presence/observations; IndexedDB private transactions | `StoragePort` owns the contract |
| Browser storage | `storage.local` plus bounded `storage.sync` | Technical preferences locally; provider-ID snapshot through browser sync | `BootstrapPort`; never authoritative domain storage |
| Contracts | Zod 4 at untrusted boundaries | Runtime validation for messages, imports, and HTTP payloads | Schemas are exposed through application contracts |
| Optional API | Hono on Cloudflare Workers | Small TypeScript edge surface without a server framework | `PublicDataPort` and a Cloudflare adapter |
| Public database | Cloudflare D1 | Normalized reconstructible catalogue close to the Worker | `CataloguePort`; no private rows or binary assets |
| Media | R2 origin plus Cloudflare Images transformations | Owned delivery, fixed variants, format negotiation and CDN caching | `MediaPort`; D1 stores only keys and provenance |
| Architecture enforcement | dependency-cruiser | Executable import-boundary rules for ports and adapters | Configuration, not runtime coupling |
| Tests | Vitest, Browser Mode, Playwright, `web-ext`, Workers test pool | Covers pure logic, DOM, real extension context, Firefox package, and `workerd` | Root verification commands |

## Extension framework research

WXT is selected because it treats Chrome and Firefox packaging as a primary
workflow, provides typed extension APIs and entrypoints, and documents store
publishing. Its main risk is a pre-1.0 API surface. Mitigations are an exact
version pin, an upgrade ADR, contract tests around the WXT adapter, and a rule
that prevents the application and domain layers from importing WXT.

Plasmo was rejected for the baseline because its current release line remains
alpha and would add comparable framework coupling without a stronger
maintenance signal. Raw WebExtensions plus Vite was rejected for v1 because it
would make this project own manifest variants, HMR, packaging, and publishing
logic. It remains the fallback if WXT maintenance or compatibility degrades.

Ruby on Rails is not selected now. Rails becomes worth reconsidering if
Tobirink adds accounts, payments, authoritative server synchronization, complex
moderation, or a substantial operator back office. Adding Rails before those
needs would duplicate domain contracts across Ruby and TypeScript and shift a
local-first product toward a server-centred architecture.

## Infrastructure gate

Product code never calls Wrangler, D1, R2, KV, Durable Objects, Queues, or a
provider SDK directly. A project-owned command exposes `inspect`, `plan`, and
`apply` operations. `apply` requires a fresh plan, an account/resource
allowlist, and explicit user approval for that exact operation. Changing cloud
providers means replacing adapters and operational drivers, not rewriting the
domain.

## Data authority and recovery

Browser bookmarks own presence and observed progress; IndexedDB owns private
transactional artifacts, works, decisions, tasks and agenda. Source removal
marks absence without deleting historical records. Work IDs remain independent
of bookmark IDs and providers; source→Work does not require a Review.

Browser sync contains only versioned provider-ID sets and fragment manifests.
Reset follows rescan, sync read, exact hydration, aliases, parsing and resolution.
Export and encrypted backup separately recover private history. No backup locator
or wrapped key is newly written into sync. The [v3 correction plan](systems/favorite-resolution-correction-plan.md)
fixes quotas, generation/digest validation and additive legacy compatibility.

Encrypted backup v1 creates a fresh 256-bit AES-GCM data key for every export.
The payload and data key use separate 96-bit nonces; a PBKDF2-SHA-256 key with
310,000 iterations and a fresh 128-bit salt wraps the data key. The version and
format are authenticated as additional data. The application returns only a
strict serialized ciphertext envelope. `R2EncryptedBackupAdapter` accepts that
envelope plus an opaque locator, uses a conditional immutable write, and has no
key or passphrase parameter. Restore unwraps, decrypts and validates the full
private export before the existing confirmed atomic replacement is invoked.
There is no public backup HTTP route in this step.

## D1 query policy

D1 tables separate works, localized titles, external references, media assets,
and catalogue revisions. Provider payload archives and all binaries stay out
of SQL. Every public endpoint uses prepared statements, narrow column
projections, bounded limits, and cursor pagination on stable ordered keys.

Indexes are derived from proven query shapes: unique `(provider, external_id)`,
exact case-insensitive title lookup by `(title, work_id)`, lookup by Tobirink
work ID, incremental catalogue reads by `(revision, id)`, and media lookup by
`work_id`. `EXPLAIN QUERY PLAN` must show indexed search for
hot paths; `meta.rows_read` and rows returned form the cost budget. Indexes are
not added speculatively. Migrations run `PRAGMA optimize`; global read
replication is introduced only after measured latency justifies it.

The materialized read API exposes `GET /v1/catalogue`,
`GET /v1/catalogue/works/:workId`, and
`GET /v1/catalogue/resolve?provider=&externalId=`. It also exposes the bounded
exact lookup `GET /v1/catalogue/search?title=&limit=` for ambiguous Review
contexts. Incremental pages order by
the stable `(revision, work_id)` pair, default to 50 rows, reject limits above
100, and return the last emitted pair as the next cursor only when another row
exists. A work detail bounds localized titles and external references to 32
rows each. Successful reads are publicly cacheable for five minutes with one
hour of stale revalidation; invalid and missing resources use `no-store`.

## Verified public discovery cache policy

The public discovery cache maps versioned normalized-key fingerprints and media
to verified public provider IDs. It has no owner, installation identity,
pairing, product consent or client credential. A client can atomically reserve
one pending search and propose provider IDs only; it cannot publish a title or
a trusted catalogue result. Concurrent clients see `PENDING`, and `VERIFIED`
entries are reused without another title search.

Only the GitHub collector authenticated by OIDC can hydrate the proposed IDs,
verify an official provider title against the fingerprint and promote the row
to `VERIFIED`. ADR-0046 defines the bounded requests, leases and idempotent D1
state transitions. Historical Collective migrations remain versioned but their
routes and runtimes are retired. Only the operational gate may apply production
migrations.

## Image policy

An image is ingested only when its source terms or rights permit copying. The
pipeline validates type and bounded dimensions, normalizes orientation and
colour space, removes sensitive metadata while retaining required attribution,
computes a content hash, and stores one normalized master in private R2.

Delivery accepts only three named cover variants: `cover-sm` 96×144,
`cover-md` 192×288, and `cover-lg` 384×576. Transformations use `scale-down` or
`contain`, never upscale or crop cover art, negotiate AVIF/WebP with fallback,
and apply bounded perceptual quality. Palette quantization is reserved for
eligible flat PNG artwork after a visual-quality check; continuous-tone covers
use AVIF/WebP quantization to avoid banding.

Variant parameters are server-owned rather than accepted from arbitrary query
strings. Immutable content-addressed URLs and long CDN caching mean a changed
cover gets a new key instead of requiring a purge. D1 stores the R2 key, hash,
dimensions, provenance, rights status, and current revision—not image bytes.

The materialized delivery route is
`GET /v1/media/covers/:sha256/:extension/:variant`. Both the extension and the
variant are allowlisted, any query string is rejected, and the Worker owns the
dimensions, fit, output quality, format negotiation, cache headers, and ETag.
Masters live under `covers/masters/sha256/<digest>.<extension>` in the private
`COVER_BUCKET`; `COVER_IMAGES` performs the bounded transform. Ingestion is not
public HTTP: the Cloudflare adapter accepts only already normalized masters,
checks copying rights before any R2 access, and uses a conditional immutable
write with a SHA-256 checksum.

## Public release calendar

The Worker owns a daily public calendar built from independent AniList
`airingSchedule` and MangaUpdates release lanes. D1 stores only public release
events, provider work IDs, release kind, `DATE` or `INSTANT` occurrence,
provenance, schema versions, state, and expiry. It stores no title, URL,
favorite, progress, owner, installation, or provider payload.

`GET /v2/releases` accepts only a bounded UTC window, cursor, and limit. It
returns stable cursor pages, an ETag, and the same result for every
installation. The extension requests the common window, follows every page,
and commits a generation to IndexedDB only after all pages agree on its
revision and window. `304`, offline operation, timeout, 429, or a malformed
page preserves the last valid generation. `/v1/releases` and its R2 snapshot
remain available as a compatibility and rollback surface while v2 is proven.

The local Agenda joins public events to locally resolved AniList or
MangaUpdates IDs through IndexedDB indexes. It never joins by title and never
contacts a provider while the Agenda is being read. Civil `DATE` values never
become fake UTC midnights; `INSTANT` values retain their exact UTC instant.
Official events replace estimates, and estimates never schedule native
notifications. Manga estimates use at most twelve confirmed observations and
eight filtered positive intervals, require three valid intervals, and produce
only the next date.

## Research anchors

- [WXT documentation](https://wxt.dev/) and [publishing guide](https://wxt.dev/guide/essentials/publishing.html)
- [Chrome Manifest V3](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3) and [extension service workers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers)
- [MDN WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [Dexie transactions](https://dexie.org/docs/Dexie/Dexie.transaction%28%29)
- [Hono documentation](https://hono.dev/docs) and [Hono on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/)
- [Zod 4](https://zod.dev/v4)
- [Cloudflare Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare D1 index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
- [Cloudflare Images transformation features](https://developers.cloudflare.com/images/optimization/features/) and [pricing model](https://developers.cloudflare.com/images/pricing/)
- [R2 CDN caching](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)
- [Chrome storage quotas](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Vitest Browser Mode](https://vitest.dev/guide/browser/) and [Playwright extension testing](https://playwright.dev/docs/chrome-extensions)
- [Cloudflare Workers testing](https://developers.cloudflare.com/workers/testing/)
