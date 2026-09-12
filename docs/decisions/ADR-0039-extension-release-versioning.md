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
- Revised: 2026-09-12

## Context

Published browser archives use immutable, versioned URLs. Replacing an archive
under an existing version can leave installed browsers with stale cached code.

## Decision

Every corrective extension build increments the extension package version
(`1.0.1`, `1.0.2` for the initial cover repair, `1.0.3` for resumable cover
repair, `1.0.4` for resolution during sync restoration, then `1.0.5` for
library projection reconstruction, `1.0.6` for rejecting non-media generic
links, `1.0.7` for explicit MangaUpdates hydration fallback, and `1.0.8` for
excluding pre-serialization matches; `1.0.9` fixes cover referrer handling,
unique complete MangaUpdates matching and blocked-queue recovery; `1.0.10`
restores the MangaUpdates Origin transport rule, accepts absent cover URLs
and prevents HTTP 403 from selecting a fallback; `1.0.11` recognizes Comix
title/chapter routes as manga and prevents cached site-rule downgrade;
`1.0.12` restores durable recovery, honest provider pagination, primary linked
identities, complete library projection and bounded Worker cover recovery;
`1.0.13` exposes inventory state and a trusted bounded reconciliation action;
`1.0.14` adds bounded, disableable local diagnostics; `1.0.15` hardens the
first-install continuation, `1.0.16` projects parsed favorites before
hydration, `1.0.17` restores cache-first sync and D1 reconstruction, and
`1.0.18` ships the bounded multi-provider, owner-scoped collective, durable
sync and pinned FavLib differential corrections; `1.0.19` keeps Library
pagination inside the surface, carries Review covers through WebBridge and
persists bounded owner-only ambiguity references in D1).
`1.0.20` accepts a cleaned bookmark title only when a generic route proves a
media release, groups public cache lookups before provider searches, and
certifies automatic first-install convergence with the corrected batch route.
The
version in `apps/extension/package.json` remains the single WXT and archive
version source; the lockfile and release tests follow it. Existing archives are
retained unchanged. Publishing a new archive remains behind the Cloudflare
infrastructure gate.

## Consequences

An update gets a cache-distinct Chrome and Firefox ZIP. A release can be built
and verified locally before the separately approved R2 publication operation.
