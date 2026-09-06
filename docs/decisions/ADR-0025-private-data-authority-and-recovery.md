---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/**
  - docs/systems/**
  - docs/workflows/**
  - apps/**
  - packages/**
  - package.json
review: on-change
revised: true
---
# ADR-0025 — Private data authority and recovery

- Status: accepted
- Date: 2026-09-02
- Revised: 2026-09-05

## Context

FavLib allowed browser bookmarks and IndexedDB to compete as authorities. That
required reconciliation for identity, membership, and progress and made cache
loss, bookmark changes, and recovery ambiguous.

## Decision

IndexedDB is the sole active authority for private Tobirink state: library
membership, progress, agenda, and durable tasks. Every work receives a stable
Tobirink ID independent of URLs, bookmark IDs, and metadata providers.

Bookmarks are an import adapter and optional outward projection. `import-only`
is the default. `import-and-project` may update a linked bookmark but bookmark
events are idempotent commands and bookmark deletion never deletes a work or
progress automatically.

`storage.local` contains only technical preferences and bootstrap state.
`storage.sync` is quota-checked and contains only a bounded, non-secret recovery
envelope. It is not authoritative and never contains images or the complete
library. Full private recovery uses a versioned local export or an opt-in
encrypted backup blob; the plaintext key and passphrase remain off server and
out of browser sync.

The encrypted backup format uses a random 256-bit AES-GCM data key per export.
A PBKDF2-SHA-256 key derived locally from the passphrase wraps that data key
with a separate salt and nonce; payload encryption uses its own nonce and
authenticated format/version context. Only the strict ciphertext envelope may
cross the backup adapter. Restore decrypts and validates the complete private
export before calling the existing confirmed atomic replacement once.

Local Agenda reads use canonical half-open time ranges through `StorageReadPort`.
Memory and Dexie adapters enforce the same maximum of 100 ordered entries; the
application joins Work records after the bounded query and reports missing
local references instead of requesting remote replacements. Dexie schema v4
indexes resolved Reviews by `matchedWorkId`; the application follows those
bounded results to their private `FavoriteSource` records. Multiple favorites
for one Work remain valid and the preferred link is chosen deterministically
by folder path, bookmark order, then stable identifier.

The public release cache is a separate strict `storage.local` envelope. It
contains at most 200 public release identities, Work identities, qualified
availability values and timestamps; it contains no source URL, progress or
user identity. The application validates it before hydrating only Agenda rows
whose Work already exists in private IndexedDB. Missing Works are reported and
the previous local Agenda is never deleted. The extension currently composes
only this cache port: the remote loader remains dormant until an origin and a
narrow host permission are explicitly approved.

Quick preferences use their own strict versioned adapter. The privacy-safe
defaults disable native notifications and show estimated releases. Enabling
notifications creates deterministic zero-lead reminders only for official or
confirmed entries; disabling them leaves durable tasks intact but prevents
publication. The estimated-release preference filters delivery projections,
not the cached or authoritative records.

Organizer projection is a confirmed outward side effect, never a second
authority. The application accepts only the exact complete preview it can
recalculate from current private state. It captures and verifies one complete
minimal bookmark-tree snapshot through a dedicated IndexedDB port before the
first move. Restore moves only surviving bookmark nodes to surviving saved
parents and indexes; it never recreates or deletes a bookmark. Local private
export v3 already includes organizer rules, while encrypted backup remains a
separate explicit opt-in flow and cannot replace IndexedDB silently.

## Consequences

Clearing a disposable cache can be repaired from stable catalogue IDs. Losing
IndexedDB requires an export or encrypted backup because public IDs cannot
reconstruct private progress. Browser sync accelerates discovery of a backup
but cannot silently become a second database.
