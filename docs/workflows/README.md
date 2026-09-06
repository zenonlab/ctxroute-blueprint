# Product workflows

## Local library update

The UI validates a command and calls an application use case. The use case
applies domain rules, persists through `StoragePort`, and returns a view model.
IndexedDB events refresh other extension contexts. No cloud call is required.

## Popup-assisted discovery

After the user opens the popup, the `activeTab` adapter reads only the active
page title and HTTP(S) URL. The background entrypoint validates the local
message and invokes the application use case, which correlates a bounded local
identity and applies the monotonic progress rule. No content script, DOM
selector, host permission or network request participates in this flow.

## Bookmark import and projection

The browser adapter converts a bookmark import or event into an idempotent
application command. The application resolves or creates a stable Tobirink
identifier and commits the result to IndexedDB. In the optional projection
mode, a separate command updates the linked bookmark after the local
transaction succeeds. Deleting or editing a bookmark never cascades into
library membership or reading progress.

## Optional public data

The application calls `PublicDataPort`. Its adapter sends a typed HTTPS request
to the Worker. Failure returns an explicit unavailable result and never blocks
private library or progress operations.

## Data migration and recovery

Startup checks the local schema version before serving use cases. A migration
runs atomically, records its version, and preserves the prior export format.
Import validates the entire document before replacing any state. Recovery and
destructive replacement require explicit user confirmation.

Clearing disposable cache triggers a rebuild from IndexedDB and the public
catalogue. It is not a recovery operation. Loss of IndexedDB requires a
versioned local export or an opt-in encrypted backup. `storage.sync` contributes
only the bounded non-secret recovery envelope needed to locate and validate
that backup. Restore downloads ciphertext, verifies integrity, decrypts on the
device, validates the complete document, and replaces local state only after
explicit confirmation and a successful atomic import.

## Public catalogue query

The Worker validates a typed request, binds repository parameters, selects only
required columns, and applies a bounded cursor. D1 returns normalized public
records; the repository reports rows read and returned for budget enforcement.
Every hot access path has a reviewed query plan and a measured index rather
than a speculative index.

## Cover ingestion and delivery

Ingestion first records the source and verifies that copying is permitted. It
rejects malformed or oversized input, normalizes orientation and color, strips
sensitive metadata while retaining required attribution, and hashes the
normalized master. The master is written once to a content-addressed R2 key;
D1 stores only its descriptor and rights state.

The client requests a named cover variant. The media gate maps that name to a
fixed scale-down/contain transformation, negotiates AVIF/WebP, and returns an
immutable cached URL. Flat PNG artwork may use visually approved palette
quantization; photographic or gradient artwork uses bounded lossy
quantization. A changed cover creates a new key instead of mutating cached
content.

## Infrastructure change

The operator first runs a read-only inspection. A plan names the provider,
account, environment, resources, changes, risks, and rollback. Only an explicit
approval permits `apply`, and the gate refuses a stale or mismatched plan.

## Development change

Every change follows the same bounded protocol: propose one step, receive
scoped approval, make its listed reversible repository mutations, update its
documentation and Progress evidence, verify it, and create the verified commit
without another `go`. In collaborative mode, request new approval for the next
step. In confirmed autonomous mode, validated materialized steps execute in
order without a new approval between steps. Expanded scope, push, deployment,
provider mutation, publication, deletion, secrets, and costs remain gated.
