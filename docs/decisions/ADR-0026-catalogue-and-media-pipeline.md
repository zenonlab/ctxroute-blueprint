---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/**
  - docs/systems/**
  - docs/workflows/**
  - apps/worker/**
  - packages/adapters-cloudflare/**
  - package.json
  - package-lock.json
  - scripts/infra/**
review: on-change
revised: true
---
# ADR-0026 — Optimized public catalogue and media pipeline

- Status: accepted
- Date: 2026-09-02
- Revised: 2026-09-05

## Context

The extension must rebuild public metadata and covers without hotlinking
arbitrary third-party assets. Storing binaries in D1, accepting unbounded image
transform parameters, or scanning unindexed catalogue rows would increase
latency and cost.

## Decision

Provider cover recovery uses a validated public provider ID to read one R2
reference object, bounded to 4 KiB, then redirects to the existing immutable
digest route. Approved master ingestion writes that association with an ETag
condition; interrupted association writes can resume after the master exists.
The public route never ingests an image or accepts a caller-supplied URL.
Library cards try the provider URL followed by one Worker fallback and retain
the failed state until the image references change. Existing rights and
normalization requirements remain enforced by master ingestion.

Use D1 only for normalized public catalogue rows and media descriptors. Use
prepared statements, bounded projections, stable cursor pagination, and indexes
that match measured query shapes. Verify hot queries with
`EXPLAIN QUERY PLAN`, `rows_read`, and rows returned. Keep raw provider archives,
private state, encrypted backup blobs, and media binaries outside D1.

Materialize catalogue revisions, works, localized titles and public provider
references as separate strict tables. Expose only read routes. Incremental
listing uses `(revision, work_id)` as its ordered cursor, reads one extra row to
decide whether a next cursor exists, and enforces a server maximum of 100 rows.
Work details bound titles and references independently. Provider resolution
uses the unique `(provider, external_id)` key. Successful GET responses may be
cached publicly; validation failures and missing records remain `no-store`.
Exact title resolution uses a dedicated `(title COLLATE NOCASE, work_id)`
index. The public route trims and bounds the query, returns at most the server
maximum, and does not perform fuzzy matching or an unindexed substring scan.

After a rights check, normalize each cover, strip sensitive metadata, preserve
required attribution, hash the content, and store one master in private R2.
Expose only the named `cover-sm`, `cover-md`, and `cover-lg` transformations.
Never upscale or crop cover art. Negotiate AVIF/WebP, use bounded perceptual
quality, and apply palette quantization only to suitable flat PNG sources after
a visual-quality check.

Serve immutable content-addressed URLs through a controlled image adapter and
Cloudflare cache. A new cover creates a new key. The API never accepts arbitrary
width, quality, format, or origin parameters. If copying is not licensed, do
not ingest or proxy the asset; use a permitted provider delivery contract or a
placeholder.

The implemented route is
`GET /v1/media/covers/:sha256/:extension/:variant`. It rejects query strings,
allowlists the master extension and named variant, reads the immutable master
from `COVER_BUCKET`, and sends only the server-owned `scale-down` dimensions to
`COVER_IMAGES`. The response negotiates AVIF/WebP, otherwise preserves the
master format, and carries immutable cache headers plus a representation ETag.
No public ingestion endpoint exists, and the Worker composition exposes only
the read port. `R2CoverMasterAdapter` is reserved for the operational gate. Its
application contract requires a bounded rights-policy identifier and a
`licensed` or `public-domain` basis before normalization checks or R2 access,
then conditionally writes the SHA-256-keyed master with checksum, provenance,
dimensions, rights policy, and required attribution. A provider image URL alone
is never a copying grant.

Hydrated provider covers follow a separate path. The extension accepts only the
fixed HTTPS image origins declared by the provider contract, preserves their
attribution in IndexedDB, and projects that reference locally through
WebBridge. A missing or failed cover attempts the ID-based Worker recovery
route once before using the local placeholder. Provider URLs never pass
through the Worker and never cause an R2 write.

Public snapshot payloads use the repository-pinned Zod 4.5.4 as a direct
adapter dependency. Strict parsing at the R2 and cache boundaries rejects
unknown fields instead of relying on TypeScript representation checks.

Worker routes depend only on injected application ports. A single Worker
composition root converts Cloudflare bindings into D1, R2, and Images adapters
and supplies the shared cloud policy. SQL, object keys, transformation calls,
quotas, response caching, and size bounds remain outside route composition.
Replacing a provider therefore changes an adapter and its wiring without
changing an HTTP route or application use case.

The public calendar is a revisioned snapshot rather than a personalized query.
`GET /v1/releases` reads `releases/current.json` and then exactly one immutable
`releases/snapshots/<revision>.json` object. The strict contract permits at most
200 entries and only public release/work IDs, label, timestamp and availability.
Request headers never select content; query parameters and unknown or private
fields fail closed. A client-side adapter validates before replacing an
injected cache and returns that last valid snapshot with an explicit `cache`
source when the remote capability is unavailable.

## Consequences

D1 reads remain predictable and media delivery is reconstructible, cacheable,
and replaceable. Three fixed variants bound transformation cardinality and
cost. The project must track provenance, rights, image quality, cache hit rate,
rows read, and orphaned R2 objects.
