---
scope:
  - packages/domain/**
  - packages/application/**
  - packages/adapters-browser/**
  - apps/extension/**
  - docs/architecture/**
  - docs/systems/**
review: on-change
revised: true
---
# ADR-0035 — Local bookmark organizer

- Status: accepted
- Date: 2026-09-06
- Revised: 2026-09-06

## Context

The options surface already presents a folder-rule editor inspired by FavLib,
but a visual fixture is not an organizer contract. Moving browser bookmarks
directly from React or from loosely ordered conditions would make previews
unreliable and couple product rules to one browser API.

## Decision

Keep organizer rules in the domain and compute previews in the application
layer. A tree contains at most 100 folders and eight levels, uses unique safe
local identifiers, and accepts only the declared media types, editorial
statuses and progress states. A folder becomes a rule only when it has at least
one explicit condition.

Enabled rules are flattened in deterministic pre-order. The first matching
rule wins and every condition inside that rule is combined with AND. A missing
value required by a higher-priority rule stops evaluation for that bookmark;
unrecognized or uncertain context always produces `keep`, never `move`.
Disabled parents disable their descendants. The preview reports the complete
destination path and distinguishes no match, insufficient context and an item
already in its destination.

The preview core is pure. It receives serializable bookmark facts and local
work context and performs no IndexedDB read, browser call, network request or
bookmark mutation. One `organizer` configuration is persisted as private state
through `StoragePort`; Dexie v5 validates it on every read and write. Private
export v3 preserves it, while v1 and v2 remain importable without inventing a
configuration.

The options runtime reads and writes this configuration through strict local
messages handled by the background composition root. Its preview joins at most
500 local favorite sources, Reviews and Works through `StoragePort`. It offers
only the `MANGA` and `ANIME` filters supported by current Work metadata;
conditions requiring unavailable editorial status or personal progress fail
closed and make the preview partial. React receives serializable models and
callbacks only. An invalid draft remains visible but cannot be persisted or
previewed.

A later apply flow must add a browser projection port, fresh preview
confirmation and a local snapshot before using
`bookmarks.create` or `bookmarks.move`. That operation requires the separately
approved bookmarks permission and must never delete a bookmark or change its
title or URL.

## Consequences

Rule semantics can be tested independently and reused across extension
surfaces without hardcoded folders. IndexedDB remains the authority for the
configuration and other private Tobirink data, while the browser bookmark tree
remains a replaceable connector. The runtime is a durable local preview
capability. Apply and restore controls stay absent until a guarded browser
projection adapter and snapshot flow provide their real callbacks.
