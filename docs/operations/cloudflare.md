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
  --operation d1-migrate:COLLECTIVE_DB \
  --operation worker-deploy
```

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

Before the first mutation, the gate verifies the plan schema and digest,
freshness, account, resource allowlist, driver identity, current provider state,
and a repeated dry-run. Any mismatch fails closed. When both operations are
approved, D1 migrations run before the Worker deployment. No CI workflow calls
`infra:apply`.

## Replacing the provider

Keep the core unchanged. Implement another driver with the same `inspect`,
`preview`, and `apply` boundary, add it at the command composition root, and run
the shared negative contract suite. Provider SDKs and commands stay in that
driver; application use cases and HTTP routes do not change.
