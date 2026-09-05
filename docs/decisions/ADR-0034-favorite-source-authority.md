---
scope:
  - docs/architecture/**
  - docs/systems/**
  - packages/domain/**
  - packages/application/**
  - packages/contracts/**
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

## Consequences

Library and Review read models can later join local source, Review, Work and
Progress records without fabricated links. Source URLs remain private and
local; they never enter D1, R2, telemetry, or public catalogue requests.
