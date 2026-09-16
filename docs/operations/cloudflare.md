# Cloudflare operations gate

Tobirink does not expose Wrangler as a release command. Every provider change
starts from the repository-owned gate, while the extension and Worker runtime
remain independent of this operational path.

## Inspect

```sh
npm run infra:inspect -- --account <cloudflare-account-id>
```

Inspection is read-only. The Cloudflare driver checks the authenticated account,
current Worker deployment, pending D1 migrations, and configured R2 buckets.
Worker, database, and bucket names are read from `apps/worker/wrangler.jsonc`.

## Plan

Choose only the operations intended for the next change:

```sh
npm run infra:plan -- \
  --account <cloudflare-account-id> \
  --operation d1-migrate:PUBLIC_DB \
  --operation worker-deploy
```

Publishing the fixed extension candidates and the matching static Worker uses
only the version-derived operations exposed by the driver:

```sh
npm run infra:plan -- \
  --account <cloudflare-account-id> \
  --operation r2-publish:tobirink-chrome-mv3-1.0.0.zip \
  --operation r2-publish:tobirink-firefox-mv3-1.0.0.zip \
  --operation worker-deploy
```

The preview hashes the exact local bytes of both ZIPs and includes those hashes
in the plan digest. The driver cannot accept another bucket, object key, local
file, or version through command-line input.

Public agenda snapshots use the same bounded path. Place the strict snapshot at
`build/releases/<revision>.json` and its strict pointer at
`build/releases/current-<revision>.json`, then plan both matching operations:

```sh
npm run infra:plan -- \
  --account <cloudflare-account-id> \
  --operation r2-release-snapshot:<revision> \
  --operation r2-release-pointer:<revision>
```

The revision accepts only 1–64 ASCII letters, digits, dots, underscores, or
hyphens. The gate validates both JSON schemas, binds both hashes to the plan,
requires a matching pair, and always uploads the immutable snapshot before the
mutable `releases/current.json` pointer.

`plan` repeats inspection and runs `wrangler deploy --dry-run` when deployment
is selected. It prints a strict JSON plan to stdout; it does not write a plan
file or mutate Cloudflare. The plan contains only hashes of inspection and
preview output, its exact actions, its account, and a short expiry. Redirecting
that output to a reviewed file is an explicit operator choice outside the gate.

## Apply

Apply is a separately approved provider mutation. The operator must supply the
reviewed plan, its exact digest, its account, and every affected resource:

```sh
npm run infra:apply -- \
  --plan <reviewed-plan.json> \
  --approve <plan-sha256> \
  --account <cloudflare-account-id> \
  --allow d1:tobirink-public \
  --allow worker:tobirink-public-api
```

For the `1.0.0` publication plan, replace the D1 allowlist with exactly:

```text
r2:tobirink-public-releases/downloads/tobirink-chrome-mv3-1.0.0.zip
r2:tobirink-public-releases/downloads/tobirink-firefox-mv3-1.0.0.zip
worker:tobirink-public-api
```

For an agenda revision, allow exactly its two materialized R2 keys:

```text
r2:tobirink-public-releases/releases/snapshots/<revision>.json
r2:tobirink-public-releases/releases/current.json
```

Before the first mutation, the gate verifies the plan schema and digest,
freshness, account, resource allowlist, driver identity, current provider state,
and a repeated dry-run. Any mismatch fails closed. When both operations are
approved, D1 migrations run before release uploads, and the Worker deployment
runs last. No CI workflow calls `infra:apply`.

The Worker serves the static export through its `ASSETS` binding on
`tobirink.com/*`. Only declared member routes fall back to the export; API and
unknown paths keep their explicit JSON/404 behavior. Versioned downloads stream
from `tobirink-public-releases` with immutable caching, attachment disposition,
ETag, and content-type metadata.

## Emergency provider shutdown

The fail-closed emergency state is versioned in `apps/worker/wrangler.jsonc`:
`workers_dev` is false, `routes` is empty and `triggers.crons` is empty. Queue
delivery is paused separately because messages and bindings must remain intact.
Apply the barriers in this order from `apps/worker`:

```sh
npm exec -- wrangler queues pause-delivery tobirink-public-discovery
npm exec -- wrangler triggers deploy --dry-run
npm exec -- wrangler triggers deploy
```

Wrangler 4.129 does not send its route replacement request when `routes` is an
empty array. If the read-only Workers Scripts Routes inventory is still
non-empty, replace only this script's routes through the official account API:

```sh
curl --fail-with-body -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts/tobirink-public-api/routes" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '[]'
```

Never print or persist the token. The response and a subsequent GET must both
report an empty result before HTTP verification.

This intentionally removes the Worker-served site, API and downloads. It does
not deploy Worker code, run D1 migrations, purge Queue messages, or delete D1,
R2, Queue or Worker resources. Verify the Queue state, unchanged active Worker
version, absent Cron Trigger and the unavailability of both the custom route and
the `workers.dev` route before declaring the shutdown complete.

Rollback requires a separate approved provider operation. Restore the reviewed
route, `workers_dev` setting and cron in the versioned configuration; deploy
triggers and verify HTTP plus the scheduled inventory; then resume Queue
delivery last:

```sh
npm exec -- wrangler triggers deploy --dry-run
npm exec -- wrangler triggers deploy
npm exec -- wrangler queues resume-delivery tobirink-public-discovery
```

Never resume the Queue before routes and scheduling are known and the D1 cost
incident has been resolved.

## Native collector observability

Outside the emergency shutdown, Agenda is scheduled by Wrangler at
`23 3 * * 0` (UTC). During the shutdown, `triggers.crons` remains empty.
Cloudflare cron changes can take up to fifteen minutes to propagate. Between
weekly triggers, no Agenda provider request is expected. The single Queue
message opens two independent D1 lanes; each lane owns one fifteen-minute lease,
a page checkpoint, `not_before`, and its last valid snapshot.

AniList is paced at one HTTP request every three seconds and MangaUpdates at
one every six seconds. Count quota consumption in HTTP requests, including
every pagination request. A `Retry-After` response becomes the per-message
Queue retry delay, capped at twenty-four hours. A partial provider failure must
leave its active snapshot and the currently served generation untouched while
allowing a changed successful lane to merge with that snapshot.

The semantic generation digest excludes collection timestamps and expirations.
For an unchanged merge, `public_release_generation.checked_at` advances without
new `public_release_generation_event` rows. Before deploying the cron change,
apply migration `0017_agenda_collection_state.sql`; after deployment, verify the
two lane rows, the active generation pointer, and the absence of provider calls
outside the controlled collection.

Public Discovery uses migration `0018_discovery_admission_state.sql`. Only an
admission `created` sends the opaque Queue signal; `existing` returns the
cached or pending state without sending and `saturated` returns 503. The
consumer accepts twenty signals, waits at most five seconds to form a batch and
permits one concurrent consumer. It invokes one `claim(20)` and acknowledges
redundant signals. The D1 outbox moves through `UNSENT`, `SENDING`, then `SENT`. If an
initial Queue send fails, keep the PENDING row and return it to `UNSENT`; an
identical POST can reclaim that unconfirmed send without creating another row.

The same migration creates `public_discovery_provider_runtime`. Inspect only
provider, timestamps and counters; it contains no title or request payload.
AniList reservations are three seconds apart and MangaUpdates reservations six
seconds apart. Three consecutive failures open the default circuit for fifteen
minutes; `Retry-After` may extend it. A successful real request clears the
failure count. `NOT_FOUND` and `AMBIGUOUS` remain cache hits for seven days,
then read as MISS and become admissible once more. Apply migration 0018 before
deploying the batched consumer or its Worker code.

Apply additive migration `0019_discovery_refresh_state.sql` before enabling
the refresh endpoint. It backfills `next_refresh_at` for existing VERIFIED
rows and adds an orthogonal refresh state; the public `state` must remain
VERIFIED while refresh work is pending or processing. Inspect only counts and
states, never `result_json`. A healthy refresh moves `IDLE → PENDING →
PROCESSING → IDLE`, emits one Queue signal on the first transition, keeps
`request_json = {}`, and advances `next_refresh_at` by seven days. An unchanged
profile must not add a catalogue revision. A provider failure or non-VERIFIED
result must leave the previous profile readable.

Apply additive migration `0020_catalogue_work_relations.sql` before deploying
relation-aware collectors. It creates only the relation table and indexes; it
does not rewrite existing works. Verify that a source publication with an
unknown exact target creates one relation with `target_work_id IS NULL`, one
PENDING exact Discovery request and one Queue signal. After the target becomes
VERIFIED, the same relation must point to its distinct work ID. Never repair a
collision by editing or merging work IDs manually; route uncertain evidence to
Review in a separately approved operation.

The Queue consumer emits one bounded JSON record with
`type=native-collector.queue`, `messageType`, `attempt` and `disposition`.
Failures add only a classified code and the bounded retry delay; raw provider
responses, titles, identifiers and envelopes are never logged. Agenda codes
distinguish `agenda-anilist-unavailable`,
`agenda-mangaupdates-unavailable`, their combined form and the unknown-provider
fallback.

### Daily adaptive-refresh counters

Filter Worker logs on `type=worker.cost` and aggregate by UTC day. Sum only the
closed numeric fields below:

- `providerRequests` for real supplier calls, grouped by `provider`;
- `d1Hits` and `d1Misses` for public cache effectiveness;
- `deduplicated` for admissions that emitted no Queue message;
- `generationsCreated` and `generationsAvoided` for Agenda publication;
- `rehydrations` for accepted weekly work refreshes;
- `d1RowsRead` and `d1RowsWritten`, sourced from `D1Result.meta` by collector
  processing only.

The other allowed dimensions are `task`, `pagesRequested`, `acceptedResults`,
`result`, `durationMs` and `retries`. Do not add titles, fingerprints, work or
provider IDs, request URLs, IP addresses, payloads, secrets or installation
identifiers to a dashboard or export. A regular lookup reports HIT/MISS but
performs zero D1 writes; no observability table exists.

Expected invariants are one Agenda session per week, zero Agenda provider call
between sessions, zero provider call on a fresh cache hit, zero Queue message
for `deduplicated`, at most one accepted rehydration per work and week, and at
most eight retries. Compare daily `d1RowsWritten` with the native Cloudflare D1
usage view before investigating a regression; never inspect `request_json` or
`result_json` for cost analysis.

`ack-success` confirms a completed message. `ack-invalid` confirms that an
untrusted malformed signal was discarded. `retry` remains recoverable.
`retry-to-dlq` means the ninth delivery has failed after eight configured
retries and the
platform will transfer an exhausted message to
`tobirink-public-discovery-dlq`. The DLQ has no consumer: inspect it promptly
from the Cloudflare Queue dashboard or Wrangler because Cloudflare retains an
unconsumed DLQ message for four days. Replaying or purging a DLQ is a separate
provider mutation and requires an exact approved target.

The Deno gateway health probe is `GET /healthz`. A configured instance returns
HTTP 200 with `{ "status": "healthy" }`; an instance missing its secret or KV
binding remains closed with HTTP 503 and `{ "error": "gateway-not-configured" }`.
The server starts before awaiting the Deno KV connection so platform warm-up
can probe health immediately. Only signed traffic awaits the lazy KV promise;
an unavailable binding fails that request closed with the same bounded 503.

## Zero-downtime gateway key rotation

The Worker signs with `PROVIDER_GATEWAY_HMAC_KEY` only. Deno accepts that
current key and, during a rotation window, one distinct
`PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS`. Both values must contain 32–256 UTF-8
bytes. An empty, duplicate, weak, oversized or third key leaves the gateway
closed. The inspection gate records environment-variable names and secret
classification, never their values.
It accepts the Deno CLI legacy `name`/`secret` and current `key`/`isSecret`
inventory shapes, normalizes both to the same value-free record, and fails
closed on an ambiguous or unknown shape.

Rotate in this exact order, with a separately reviewed provider plan and exact
approval for every apply:

1. keep the old key only in the operator environment as the previous value and
   generate the new current value outside the repository;
2. apply one Deno plan containing `gateway-previous-secret-set`,
   `gateway-secret-update` and `gateway-deploy`; the driver installs the old
   previous key before changing the current key;
3. verify `/healthz` and a signed request from the still-old Worker;
4. apply the Cloudflare secret update and Worker deployment with the new
   current key, then verify Discovery and Agenda traffic;
5. apply a final Deno plan containing `gateway-previous-secret-delete` and
   `gateway-deploy`, then repeat the traffic check.

Never combine step 5 with the Cloudflare switch. Removing the previous key is
a destructive secret mutation and remains forbidden without approval for that
exact Deno variable. Roll back before step 5 by restoring the old Worker key;
after step 5, reinstall the old Deno current key first if rollback is required.

The Deno gate never places either HMAC value in process arguments. Secret-set
operations call `deno deploy env load` with one allowlisted variable stored in
a private temporary directory and a `0600` file, then remove that directory on
success or failure. A generic failure code replaces raw CLI errors so a
provider echo cannot disclose the value. Do not replace this path with direct
`env add` or `env update-value` automation: both require the value in argv.

## Public Discovery retention

D1 records deletion eligibility without deleting data automatically:

- result nonces: seven days after ingestion;
- `FAILED` requests: thirty days after terminal failure;
- `NOT_FOUND` and `AMBIGUOUS`: fresh for seven days, then retained but read as
  expired until a new bounded admission replaces their result;
- terminal request payloads: replaced immediately by `{}` while their bounded
  result cache remains retained;
- catalogue revisions no longer referenced by a work: eligible after thirty
  days, determined at purge time.

A purge is a destructive provider operation. Before running one, export and
verify a D1 backup, inspect exact row counts, prepare bounded `DELETE`
statements for only the eligible rows, and obtain explicit approval for those
targets. The migration and runtime added here never execute those deletions.

## Replacing the provider

Keep the core unchanged. Implement another driver with the same `inspect`,
`preview`, and `apply` boundary, add it at the command composition root, and run
the shared negative contract suite. Provider SDKs and commands stay in that
driver; application use cases and HTTP routes do not change.
