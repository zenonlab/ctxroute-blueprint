---
scope:
  - apps/extension/package.json
  - package-lock.json
  - scripts/infra/**
  - docs/release.md
review: on-change
revised: true
---

# ADR-0039 — Version corrective extension archives

- Status: accepted
- Date: 2026-09-11

## Context

Published browser archives use immutable, versioned URLs. Replacing an archive
under an existing version can leave installed browsers with stale cached code.

## Decision

Every corrective extension build increments the extension package version. The
version in `apps/extension/package.json` remains the single WXT and archive
version source; the lockfile and release tests follow it. Existing archives are
retained unchanged. Publishing a new archive remains behind the Cloudflare
infrastructure gate.

## Consequences

An update gets a cache-distinct Chrome and Firefox ZIP. A release can be built
and verified locally before the separately approved R2 publication operation.
