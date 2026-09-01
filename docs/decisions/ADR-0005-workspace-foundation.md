---
scope:
  - package.json
  - package-lock.json
  - packages/**
review: on-change
revised: true
---
# ADR-0005 — npm workspace foundation

- Status: accepted
- Date: 2026-08-30

## Context

The blueprint exposes three integration boundaries but must remain reproducible,
cross-platform, and compatible with its template lifecycle.

## Decision

Use a private root npm project with `workspaces` covering `packages/*`.
Root commands remain the public entry points, and Node.js 22.13+/npm 10
remain the supported toolchain. Workspace package manifests are private,
carry the repository's Apache-2.0 license metadata, and a
clean clone is validated by `npm ci` and the root validation command.

## Alternatives

Nested package managers add lockfile drift. Git submodules add clone and CI
friction. A single flat package hides repository boundaries.

## Consequences

The root lockfile is authoritative. Workspace additions require architecture
evidence and CI coverage. The blueprint can host future package code without
selecting a product frontend or backend. The initial inventory exposes private
boundaries for CTXRoute, Archify, and official code-review-graph; upstream tools remain
external and are not vendored into the blueprint.
