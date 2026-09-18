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

The approved orphan cleanup was bounded by the gate:

```sh
npm run infra:plan -- --account <cloudflare-account-id> \
  --operation d1-migrate:PUBLIC_DB \
  --operation queue-delete:tobirink-jobs-production
```

Its apply allowlist was exactly `d1:tobirink-public` and
`queue:tobirink-jobs-production`. Plan
`b3a217a0561d3174499527b46dc21732ebd565981b5c7ee1937c38e9b03bae38`
applied migration `0025` before deleting that Queue. The consumed retired
inventory is now empty; active queues remain rejected by the driver.

The Worker serves the static export through its `ASSETS` binding on
`tobirink.com/*`. Only declared member routes fall back to the export; API and
unknown paths keep their explicit JSON/404 behavior. Versioned downloads stream
from `tobirink-public-releases` with immutable caching, attachment disposition,
ETag, and content-type metadata.

The post-cleanup publication used plan
`74c982060b8ea554797494ca6aa682c59e62b75ab0e96309f5ac6b665019266d`,
whose only action was `worker:tobirink-public-api`. Worker version
`7d514091-35ff-496d-b533-e57d13fea3fd` then served the route and weekly cron.
Production probes returned HTTP 200 for the home page, `/download`, both
published `1.0.31` archives, `/v3/releases`, and `/v4/release-models`; the
download page contains only the provider-free `1.0.31` publication links.

The extension promotion used plan
`df8f2d8beaa37dd01095338998d3962de924bc30b3b875c27acfe109f33d715b`
for the two R2 objects, followed by Worker plan
`a63179af88b96eae46f3a57a56863f9a6209f283c0642f37c5f73cf1a7a0dbea`.
The final Worker version is `25589148-ce66-43ab-9634-ed6a6a635f10`; production
hashes match the local archives exactly.

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

### État déployé le 17 septembre 2026

La migration additive `0023`/`0024` et le Worker de compatibilité
`2e2e534b-7816-445c-992a-1576a7087ccd` sont déployés. L’inspection distante
confirme qu’aucune migration ne reste à appliquer. En cas d’incident, garder
les entrées scellées et privilégier un correctif en avant. L’export D1 frais
documenté dans [`d1-cost-audit.md`](./d1-cost-audit.md) fournit le point de
restauration ; son import écrasant exige une approbation destructive distincte.
Ne pas supprimer les tables, événements
legacy ou index tant que les deux générations de lecteurs et le premier cycle
hebdomadaire des modèles n’ont pas été vérifiés.

The authoritative recovery order, approval boundaries and local budget table
are in [the A-to-Z master plan](./tobirink-a-z-master-plan.md). The only active
operational entry point is `goal-controlled-d1-service-resumption`; historical
deployment goals must not start a parallel recovery.

Before any canary, approve explicit stop thresholds. The current proposal is a
warning at 20,000 D1 writes in one UTC day and a full reseal at 50,000; reseal
also when the first Agenda reconciliation exceeds 10,000 writes, a later Agenda
cycle exceeds 500, a fresh Discovery hit writes anything, a same-work/new-key
cycle exceeds 30, or a comparable first resolution exceeds 100. These are
operating guards derived from local references 55/19/70/76–77/1,798, not remote
measurements or Cloudflare billing guarantees.

After migration 0021 and a new Agenda publication, rolling back to the old
Worker can expose a stale legacy projection. Prefer keeping all entries sealed
and deploying a forward fix. Restoring the pre-migration backup is a separate,
destructive provider operation and requires exact approval.

Outside the emergency shutdown, Agenda is scheduled by Wrangler at
`23 3 * * SUN` (UTC). During the shutdown, `triggers.crons` remains empty.
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
Migration `0021_agenda_active_projection.sql` backfills the indexed
`public_release_current_event` projection and stores a bounded JSON rollback
snapshot on each retained generation. A changed merge mutates only added,
materially changed or removed active events in one D1 batch; an unchanged merge
advances `checked_at`. The active generation plus two rollback generations are
retained. Completed Agenda pages are retained only for each lane's active
snapshot or its current interrupted collection.

Apply migrations 0017 through 0021 before deploying code that reads the active
projection. Verify the two lane rows, active pointer, 579-row projection for the
reference fixture, three retained snapshots at most and the cursor query plan.
The first reconciliation is a separate write-budget event; do not combine it
with Queue or Cron reactivation. A migration, Worker deployment, Queue resume,
route restoration and Cron restoration are five separately observable phases.

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

Migration `0020_catalogue_work_relations.sql` is historical. Relation-aware
collection was retired before producing remote rows. After a fresh D1 export,
zero-row verification and consumer audit, migration
`0025_drop_catalogue_work_relations.sql` removes only that table and its owned
indexes. Exact references that identify the same work remain in the canonical
catalogue; no season, sequel, source or adaptation creates Discovery work.

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

- `providerRequests` for every recognized supplier HTTP call, grouped by `provider`;
- `pagesRequested` only for Agenda pagination pages actually requested; Discovery reports zero;
- `d1Hits` and `d1Misses` for public cache effectiveness;
- `deduplicated` for admissions that emitted no Queue message;
- `generationsCreated` and `generationsAvoided` for Agenda publication;
- `rehydrations` for accepted weekly work refreshes;
- `d1RowsRead` and `d1RowsWritten`, sourced from `D1Result.meta` by Queue
  processing and by Discovery HTTP routes.

`providerRequests` and `pagesRequested` are independent counters: a provider
may issue more than one HTTP call for a page, and a Discovery event has no
pagination pages. The other allowed dimensions are `task`, `acceptedResults`,
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

### Local cost certification

The Miniflare D1 integration suite freezes two volume references after all
migrations are applied. Fifty simultaneous admissions for the same unknown
work converge to one request row and five aggregate `rows_written`; the other
49 admissions reuse it. One HTTP lookup containing fifty absent keys reports
357 `rows_read` and zero `rows_written`. Provider counters also count attempted
AniList and MangaUpdates calls when their responses are 429 or 5xx, while the
collector error exposed to logs remains a bounded provider/status code.

These are deterministic local regression budgets, not production usage. A
native Cloudflare cycle and the D1 dashboard reconciliation remain required
after controlled service resumption before using them for paid-plan sizing.

The baseline also records storage bytes with SQLite
`length(CAST(value AS BLOB))`. Its synthetic same-work alias creates two
identical VERIFIED profile copies totalling 678 bytes. A later counter change
leaves two distinct copies totalling 696 bytes, while the relational preferred
title, titles and reference strings total 15, 59 and
6 bytes. These values expose current duplication; they are not database-file
size, index bytes or billable writes. The metrics wrapper trusts only native
`D1Result.meta`: a 64,000-character returned payload with `rows_written=1`
still counts as one write.

### Remote measurement checkpoint — 2026-09-17

At `2026-09-17T10:12:08Z`, `wrangler d1 info PUBLIC_DB --json` reported a
rolling 24-hour window of 23,567 rows read, 5,753 rows written, 345 read
queries, 720 write queries and 1,257,472 bytes of database storage. The
deployed Worker remained version `bfd038ea-4596-49aa-9add-7de77af5056c` at
100%, with no pending D1 migration and one producer plus one consumer attached
to the primary Queue.

A controlled one-key MISS lookup observed through `wrangler tail` completed
with HTTP 200, 9 ms CPU time and 28 ms wall time. Its bounded `worker.cost`
event reported 64 D1 rows read, zero D1 rows written, zero provider requests
and no accepted result. No request key or response payload is retained in this
runbook.

Two controlled MISS lookups occurred between the first native snapshot and a
second snapshot at `2026-09-17T10:14:58Z`. The rolling native values then read
23,652 rows read, 5,753 rows written, 348 read queries and 720 write queries:
an observed delta of 85 rows read, zero rows written and three read queries.
This is not an exact per-request reconciliation. The native counters are a
moving 24-hour aggregate with ingestion delay, while the application event is
per invocation and only one of the two lookups was tailed. Certification must
therefore compare complete UTC intervals after analytics have settled; it must
not force equality between an instantaneous tail event and two rolling
snapshots.

`wrangler d1 insights` confirms retained query analytics rather than only live
tail output. The seven-day view still includes the retired materialized Agenda
path, including 166,476 rows written by per-event generation inserts. The
one-day view still contains pre-cutover Agenda cleanup, including 13,896 rows
written by one retained-generation deletion shape. These historical queries
must be separated from the corrected version's post-deployment interval before
the seven-day economic result is certified.

The bounded post-cutover query at `2026-09-17T10:16:28Z`, using
`wrangler d1 insights PUBLIC_DB --time-period 10h`, isolates the corrected
runtime from approximately 00:16 UTC. Across 25 query shapes and 32 executions,
it reports 4,753 rows read, **zero rows written** and 70.3341 ms cumulative D1
query time. This reconciles the apparent write activity in the wider views,
but ten hours with no scheduled weekly cycle is only an early canary. It does
not certify the seven-day interval or an Agenda collection.

### Final seven-day reconciliation procedure

The certification interval is fixed at
`2026-09-17T00:29:00Z..2026-09-24T00:29:00Z`. Do not replace it with a later
rolling seven-day window. Cloudflare retains D1 analytics for 31 days, so query
that exact UTC interval through the D1 Metrics dashboard or GraphQL Analytics
API. Use `wrangler d1 insights PUBLIC_DB --time-period 7d --limit 1000 --json`
only as a corroborating query when run at the interval boundary; its rolling
window is not an exact substitute when run later.

For the same fixed interval:

1. export only retained Workers Logs whose parsed message has
   `type=worker.cost`, then group by UTC date, `task`, `provider` and `result`;
2. sum `d1RowsRead`, `d1RowsWritten`, `providerRequests`, `pagesRequested`,
   `acceptedResults`, `retries` and `durationMs`, and count Agenda sessions;
3. obtain native D1 `rowsRead`, `rowsWritten`, read/write query counts,
   response bytes, query time and maximum storage bytes for the database;
4. list D1 insights by total writes and reads, retaining the normalized query
   shape, execution count and totals but no bound parameters or result data;
5. record Queue delivered/retried/failed counts, Worker invocations/CPU, R2
   Class A/Class B operations and provider request counts as separate units;
6. verify that version `bfd038ea-4596-49aa-9add-7de77af5056c` served the
   interval, the cron remained `23 3 * * SUN`, and the primary Queue retained
   exactly one producer and one consumer.

Native D1 totals cover every database caller. `worker.cost` covers instrumented
Discovery HTTP and Queue processing, but not ordinary Catalogue or Agenda
public reads, operator inspections, migrations or direct D1 diagnostics.
Therefore reconcile the difference with D1 query shapes and invocation counts;
do not require the two aggregates to be identical. Every native write absent
from `worker.cost` needs a named query shape and an authorized cause.

The interval passes only when it contains the Sunday Agenda attempt, no
unexpected provider call occurs between Agenda sessions, no retry loop exceeds
the configured bound, no unexplained D1 write remains, and the previous valid
Agenda remains readable after any failed lane. Record zero-change weeks as a
real measured outcome. Keep the step open if logs are missing, analytics have
not settled or the exact interval cannot be reconstructed.

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

## Gateway 401 diagnostics

The gateway is the authority for separating authentication layers:

- `401 {"error":"invalid-signature"}` means the HMAC signature was absent,
  malformed or invalid. The request did not reach a provider and the log event
  uses `auth_failure_layer=gateway`.
- `401 {"error":"anilist-auth-failed"}` means AniList returned upstream 401.
  The event uses `provider=anilist`, `upstream_status=401` and
  `auth_failure_layer=upstream`.

Every gateway event contains only the bounded fields
`gateway_request_id`, `provider`, `upstream_status`, `status`, `duration_ms`,
`auth_failure_layer` and `retries`. The response also exposes the opaque
`X-Tobirink-Gateway-Request-Id` for correlation. Do not log or export titles,
fingerprints, complete URLs, request or response bodies, tokens, or secrets.
Gateway retries are currently `0`; Queue retry count is authoritative in the
Worker `native-collector.queue` and `worker.cost` events.

AniList public catalogue data does not require OAuth. The gateway therefore
does not add an `Authorization` header to Discovery requests. A future private
AniList feature must be designed separately and keep its token in the Deno
secret store only; never add it to Worker bindings, `wrangler.jsonc`, bundles,
or logs.

For an incident, first correlate the Worker response's gateway request ID with
the Deno event, then inspect only the provider name, statuses, duration and
retry count. A gateway-layer 401 requires checking the Worker/gateway HMAC
configuration. An upstream-layer AniList 401 requires checking the upstream
availability and request policy; it does not justify copying the upstream body
into logs or returning an unverified Discovery result.

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
provider echo cannot disclose the value. Current-key updates use Deno's
`--replace` flag because the current secret already exists; the driver remains
the only place that supplies this flag. Do not replace this path with direct
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
