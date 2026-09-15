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

## Native collector observability

The Queue consumer emits one bounded JSON record with
`type=native-collector.queue`, `messageType`, `attempt` and `disposition`.
Failures add only a classified code and the bounded retry delay; raw provider
responses, titles, identifiers and envelopes are never logged. Agenda codes
distinguish `agenda-anilist-unavailable`,
`agenda-mangaupdates-unavailable`, their combined form and the unknown-provider
fallback.

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

## Zero-downtime gateway key rotation

The Worker signs with `PROVIDER_GATEWAY_HMAC_KEY` only. Deno accepts that
current key and, during a rotation window, one distinct
`PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS`. Both values must contain 32–256 UTF-8
bytes. An empty, duplicate, weak, oversized or third key leaves the gateway
closed. The inspection gate records environment-variable names and secret
classification, never their values.

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
