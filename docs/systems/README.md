# Product systems

## Domain and application

The domain owns library entries, reading progress, agenda rules, and invariants.
Application use cases coordinate the domain and request external capabilities
through ports. Neither layer knows the browser, UI framework, database library,
network transport, or cloud provider.

## Extension delivery

The extension application owns popup, product-page, options, background, and
content-script entrypoints. WXT generates Manifest V3 variants and browser
packages. Its adapter implements browser ports for bookmarks, alarms,
notifications, storage events, tabs, and messaging.

Bookmarks are a replaceable connector. The default mode imports bookmark
events into application commands. An optional mode also projects selected
changes back to the linked bookmark. A bookmark identifier or URL never becomes
a domain identifier or an authority for membership and progress.

## Local persistence

The storage package defines `StoragePort`, versioned records, migrations,
export, import, and recovery contracts. The first adapter uses Dexie and
IndexedDB, which is the sole active authority for the private library,
progress, agenda, and durable task queue. `storage.local` is limited to
technical preferences and bootstrap state. `storage.sync` may hold only a
small, quota-checked, non-secret recovery envelope; it does not mirror the
database. Private state remains on-device and local functionality cannot depend
on the public service.

The installed MV3 background is the local composition root. It creates one
Dexie adapter per worker lifetime and lazily opens `tobirink-private` before a
validated popup-context response. This activates schema migration without a
background-wide record scan. React surfaces receive serialized messages only;
they never import Dexie or open IndexedDB directly. The popup continuation
cache remains a separate, disposable `storage.local` record.

On the explicit extension installation or update event, the browser adapter
reads the bookmark tree and emits serializable records with their folder path
and sibling order. The application imports HTTP(S) entries into IndexedDB in
bounded batches, atomically pairing each `FavoriteSource` with its Review. A
rerun preserves the initial import time and resolved decisions; missing browser
bookmarks are not interpreted as local deletions.

An imported bookmark is preserved as a private `FavoriteSource`: its stable
Tobirink source identity, external bookmark identifier, raw title, HTTP(S) URL,
folder path, sibling order, import time and associated Review. Resolution stays
on the Review record, and only a resolved Review points to a `Work`. This keeps
the original navigation target available after import without turning either
the bookmark or its URL into a Work identity. Favorite-source reads are bounded
and ordered by stable source ID.

Full recovery uses a versioned local export or an explicit opt-in encrypted
backup. Encryption happens before upload, and neither the service nor browser
sync stores the plaintext key or passphrase. Public catalogue records are
reconstructed from stable Tobirink identifiers instead of being copied into
the backup.

The cloud recovery use case creates an AES-GCM ciphertext envelope locally and
passes only that envelope to the R2 adapter. A restore decrypts and validates
the entire private export first; failed authentication or validation never
calls the authoritative store replacement. The adapter provides immutable
blob I/O only and cannot receive cryptographic secrets.

## Optional public service

One Hono Worker may expose the public catalogue, anonymous public reviews, or
calendar data. D1 stores normalized works, localized titles, external
references, media descriptors, and catalogue revisions through a repository
adapter. It stores no image binary, private library record, or raw provider
archive.

Calendar delivery is one shared `GET /v1/releases` snapshot from R2, not a user
feed. The strict object contains no installation, library, progress, reminder or
account identifier. The extension may retain only the last validated snapshot
behind its local cache port so Agenda remains readable offline.

D1 repositories use prepared statements, narrow projections, bounded cursor
pagination, and indexes justified by measured access paths. Hot queries are
reviewed with `EXPLAIN QUERY PLAN` and runtime row metrics; migrations run
`PRAGMA optimize` after index changes. Read replication is enabled only after
measurements show that its consistency and latency trade-off is appropriate.

## Media delivery

Only media whose rights allow copying enters the pipeline. Ingestion validates
type, byte size, dimensions, and attribution; normalizes orientation and color;
strips sensitive metadata; and hashes the normalized content. One normalized
master is stored under an immutable content-addressed R2 key.

Cloudflare Images exposes only three server-owned variants: `cover-sm`
(96 x 144), `cover-md` (192 x 288), and `cover-lg` (384 x 576). Covers use
scale-down/contain without crop or upscale and negotiate AVIF/WebP at bounded
quality. Palette quantization is reserved for flat PNG artwork after visual
verification. Clients cannot supply arbitrary origin, width, quality, or fit
parameters. If copying is not permitted, the system keeps attribution and a
permitted provider reference or serves a placeholder; it does not ingest or
proxy the asset.

## Infrastructure operations

Provider drivers are separate from product runtime code. The only mutation path
is the approved operational gate: inspect current state, create a bounded plan,
then apply that exact plan after user approval.

`scripts/infra/provider-gate-core.mjs` owns this provider-neutral contract.
`scripts/infra/cloudflare-driver.mjs` is the replaceable Wrangler translation,
and `scripts/infra/tobirink-provider-gate.mjs` is the sole command composition
root. Resource names come from `apps/worker/wrangler.jsonc`; none are duplicated
in the gate. See [`docs/operations/cloudflare.md`](../operations/cloudflare.md)
for the non-mutating and approved workflows.
