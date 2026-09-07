---
scope:
  - package.json
  - package-lock.json
  - apps/extension/**
  - .gitignore
  - eslint.config.mjs
  - oxlint.config.ts
  - docs/architecture/src/tobirink.architecture.json
review: on-change
revised: true
---

# ADR-0031 — WXT extension shell

- Status: accepted
- Date: 2026-09-04
- Revised: 2026-09-06

## Context

The React surfaces under `apps/extension/entrypoints` are product components
and Workbench previews, not browser entrypoints. Treating that directory as a
WXT source would package tests and previews as scripts and blur the boundary
between reusable UI and the installed extension.

The release gate also requires generated Chromium and Firefox manifests,
least-privilege permissions, local-only extension code and validated runtime
messages.

## Decision

Use WXT 0.21.4 with its React module as the Manifest V3 build adapter. Keep the
existing product surfaces unchanged and configure `wxt-entrypoints` as WXT's
dedicated entrypoint directory. HTML entrypoints mount the existing popup and
settings components; unlisted product pages mount the existing library, Review
and agenda surfaces. Contextual reprise belongs to the popup and product pages;
no additional persistent contextual surface is packaged.

Generate permissions from `wxt.config.ts`. Allow only `storage`, `bookmarks`,
`alarms` and `notifications`. Bound host permissions to the exact HTTPS origins
of AniList GraphQL, MangaUpdates API and Kitsu; these permissions enable only
the catalogue adapters composed by the background. Keep extension scripts under
`script-src 'self'` with object embedding disabled.
Firefox builds declare the stable signing identifier `tobirink@tobirink.local`
and `data_collection_permissions.required: [bookmarksInfo]`. Resolution sends
only a parsed title or an explicit provider identifier to the selected public
catalogue. Raw bookmark URLs, folders, progress and the resulting local library
are not transmitted.

The background entrypoint owns WebExtension API access. Browser globals are
read only inside its `main` callback. Its message router accepts only a closed,
versioned set of commands, validates every field before dispatch, and returns a
structured error for malformed or unknown inputs.

The background also owns the extension-local composition root. It constructs
the Dexie storage adapter once per worker lifetime and opens the versioned
`tobirink-private` database lazily inside the already validated popup-context
request. Opening runs schema migration before the response, but startup never
scans or materializes private collections. The popup continuation cache remains
a separate bounded `storage.local` adapter and never becomes authoritative. The
extension workspace declares `@tobirink/adapters-indexeddb` directly because
the composition root imports it; the dependency is not obtained transitively.

Installation, startup, alarm and bookmark mutations request local convergence.
The browser adapter traverses `bookmarks.getChildren()` with an owned DFS
cursor and returns at most 100 serializable leaves. IndexedDB persists the
cursor and the latest mutation per bookmark; a worker wake processes at most
eight slices and resumes without flattening the complete tree. The inventory
phase itself performs no provider or public-service request.

Review reads use a separate versioned message. The background opens IndexedDB
only after that validated request and delegates to an application query capped
at 100 pending records. The response is a frozen, serializable snapshot; it
does not expose Dexie records, browser APIs or a provider client to React.

Agenda reads hydrate the strict public release cache before querying the local
period. The background never composes the dormant remote loader. A named
one-minute browser alarm and `runtime.onStartup` both drain the durable task
store in batches of at most 20. Tasks remain unavailable until their exact
release time, use the browser notification identifier as their deduplication
key, and publish only while the persisted native-notification preference is
enabled. Preference messages expose only the two versioned booleans used by
Agenda and the popup.

Expose the extension accessibility contract through the root
`npm run test:a11y` gate. The gate renders every packaged surface, checks its
semantic shell and verifies the shared contrast, focus, reduced-motion and
responsive CSS invariants without adding a browser-runtime dependency.

Expose a separate `npm run test:performance` gate. It builds both browser
targets, measures representative local React renders against the 200 ms budget,
checks each generated package against the 1.5 MB compressed target, and rejects
background startup code that scans storage or depends on the network.

Package release candidates through `npm run package:extension`. The project
builds both targets from scratch and writes deterministic, sorted ZIP archives
with fixed metadata plus a SHA-256 manifest under ignored `.output/packages`.
Packaging never signs, uploads, publishes or deploys an extension.

## Consequences

The extension can be built for Chromium and Firefox without changing the visual
components or making WXT a product-domain dependency. The generated manifests
and message contract become executable security evidence. Adding a browser
permission, host permission or message kind requires an explicit contract and
test change.

Generated `.wxt` metadata and `.output` bundles remain ignored by Git and
source linters; security tests inspect the built manifests explicitly instead
of treating generated third-party code as maintained source.
Automated accessibility evidence remains distinct from the manual Chromium and
Firefox pass, which must be recorded honestly when those browsers are available.
The render benchmark is likewise a deterministic build-time guard rather than a
claim about browser paint timing; real-browser interaction remains a release
smoke requirement.
Rollback is an operator-owned installation of a previously retained, verified
artifact; the repository tests prior-version selection but never changes an
installed browser extension automatically.
