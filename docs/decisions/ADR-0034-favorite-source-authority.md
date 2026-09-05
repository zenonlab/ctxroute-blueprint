---
scope:
  - package-lock.json
  - docs/architecture/**
  - docs/systems/**
  - packages/domain/**
  - packages/application/**
  - packages/contracts/**
  - packages/adapters-browser/**
  - packages/adapters-indexeddb/**
review: on-change
revised: true
---

# ADR-0034 — Preserve imported favorite sources locally

- Status: accepted
- Date: 2026-09-05
- Revised: 2026-09-06

## Context

`Work` deliberately contains a provider-independent Tobirink identity, but the
installed extension also needs the original bookmark URL, browser-folder order
and import time to reopen a useful source and reconstruct Review. Keeping that
information only in browser bookmarks would make the connector authoritative;
putting it in `Work` would mix private navigation data with public identity.

## Decision

Add `FavoriteSource` as a private domain record stored in IndexedDB. It owns a
Tobirink `source_*` identifier, the external bookmark identifier, raw title,
HTTP(S) URL, folder path and sibling order, canonical import time, and the
associated Review identifier. A Review remains the authority for resolution;
its optional matched Work links the source to a stable work without making the
bookmark identifier or URL a Work identity.

The application storage port exposes bounded, stable-ID pagination for favorite
sources. Dexie owns the versioned store and validates every record on reads and
writes. Private export version 2 includes favorite sources; version 1 remains
importable and materializes an empty source collection. Browser deletion never
deletes a Work, progress record, or remembered source automatically.

Initial and update installation events import eligible HTTP(S) bookmarks in
bounded local transactions. Reimport updates the source placement and raw data,
but preserves its original import time and any existing resolved Review. An
interruption may leave completed batches visible; rerunning the idempotent
import safely converges without deleting local records absent from bookmarks.

The local Review queue is read through the existing `status` index with an
explicit maximum of 100 rows. Only `pending` Reviews enter that snapshot;
resolved and no-match decisions remain stored but are excluded. Reading the
queue does not contact D1 or any metadata provider.

A candidate-resolution context joins one pending Review to at most one
`FavoriteSource` through the existing `reviewId` index. Duplicate links are
treated as corrupted private state instead of selecting an arbitrary source.
The raw favorite URL may be inspected only by a local source-reference parser;
the candidate port receives at most a public provider/external identifier and
a bounded title query, never both. Its result is capped before it reaches a
delivery surface. A replaceable local revision port with a deterministic
default derives an opaque token from the records so a later decision can
reject stale context without returning the private URL. No network
adapter is composed by this contract step; any future remote implementation
still requires an explicit disclosure gate and a narrowly scoped host
permission.

The HTTP candidate adapter remains outside the application core. Its
constructor accepts only an HTTPS origin with no credentials, path, query, or
fragment, plus an injected fetch function. It translates the exclusive
reference/title query to the owned catalogue routes, validates the complete
JSON shape, rejects oversized results, and converts only public Work fields.
It is exported but not composed by the extension background, so introducing
the adapter alone neither transmits data nor changes browser permissions.

## Consequences

Library and Review read models can later join local source, Review, Work and
Progress records without fabricated links. Source URLs remain private and
local; they never enter D1, R2, telemetry, or public catalogue requests.
