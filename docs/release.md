# Extension packaging and rollback

## Build a release candidate

The current candidate is `1.0.0`. `apps/extension/package.json` is the only
version source: WXT reads it for both manifests, the packager reads it for ZIP
names, and the download page derives its two public links from it.

Run `npm run package:extension` from the repository root. The command rebuilds
both browser targets and writes these ignored, reproducible artifacts:

- `apps/extension/.output/packages/tobirink-chrome-mv3-<version>.zip`
- `apps/extension/.output/packages/tobirink-firefox-mv3-<version>.zip`
- `apps/extension/.output/packages/release-manifest.json`

ZIP entries are sorted, compressed with a fixed level and carry a fixed DOS
timestamp. The packager creates each archive twice in memory and refuses a byte
difference. The manifest records target, version, file count, byte size and
SHA-256.
The release packager also injects and verifies the exact non-secret bridge
origin `https://tobirink.com/*` in both generated manifests.

Packaging is local only. It never signs, uploads, publishes, deploys, edits a
store listing or handles store credentials. Submission remains a separate
manual operation after the browser checks in `docs/browser-support.md` pass.

The production download paths are versioned and fixed to the Worker domain:
`https://tobirink.com/downloads/tobirink-chrome-mv3-<version>.zip` and
`https://tobirink.com/downloads/tobirink-firefox-mv3-<version>.zip`. The page
may reference these paths only after the matching ZIPs and SHA-256 manifest have
been accepted and uploaded through an explicitly approved provider operation.

## Release verification

1. Run `npm run package:extension`.
2. Run `npm run verify` and retain its output with the release candidate.
3. Compare each ZIP SHA-256 with `release-manifest.json` before transfer.
4. Load the exact ZIP in the matching browser and complete the manual journeys.
5. Retain the accepted ZIP and manifest outside the generated build directory
   before creating the next version.

For `1.0.0`, the local publication candidates are exactly:

- `tobirink-chrome-mv3-1.0.0.zip`
- `tobirink-firefox-mv3-1.0.0.zip`
- `release-manifest.json`

The `1.0.0` publication was applied through the separately approved provider
gate. Future publications replace the placeholders with their reviewed account,
plan path and digest in this exact repository-owned command sequence:

```sh
npm run infra:inspect -- --account <cloudflare-account-id>
npm run infra:plan -- --account <cloudflare-account-id> --operation r2-publish:tobirink-chrome-mv3-1.0.0.zip --operation r2-publish:tobirink-firefox-mv3-1.0.0.zip --operation worker-deploy
npm run infra:apply -- --plan <reviewed-plan.json> --approve <plan-sha256> --account <cloudflare-account-id> --allow r2:tobirink-public-releases/downloads/tobirink-chrome-mv3-1.0.0.zip --allow r2:tobirink-public-releases/downloads/tobirink-firefox-mv3-1.0.0.zip --allow worker:tobirink-public-api
```

These commands are documentation, not authorization.
The plan preview binds the two ZIP byte hashes and the Worker dry-run output to
its digest; the apply gate repeats both checks immediately before mutation.

## Rollback

Rollback never mutates local user data and is never automatic.

1. Stop distribution of the current candidate.
2. Select the latest previously accepted artifact whose version differs from
   the rejected version and whose SHA-256 still matches its retained manifest.
3. Reinstall or resubmit that exact browser-specific ZIP through the manual
   browser/store process.
4. Re-run the critical local/offline journeys and confirm that the IndexedDB
   schema is compatible before resuming distribution.
5. Record the rejected version, retained version, hashes and reason.

`scripts/release/package-extension.test.mjs` proves that packaging is stable
under input reordering and that rollback selection refuses a missing verified
previous artifact.

## TobiRink preversion and clean-room cutover

The TobiRink candidate is evaluated beside FavLib. The candidate uses a fresh
extension identity, `tobirink-local-v1`, the isolated Worker/D1/R2 names in
`apps/worker/wrangler.jsonc`, and a separate static export. No FavLib database,
ID, artifact or Cloudflare resource is read during this comparison.

Before a human approval, retain the following evidence together:

1. `npm run package:extension` output and the Chrome/Firefox SHA-256 manifest.
2. `npm run archify:validate -- tobirink-ux.dataflow` and the UX/accessibility,
   bridge, security and performance results.
3. The static site export and Worker route smoke checks.
4. The exact resource inventory from `npm run infra:inspect`, followed by a
   reviewed `npm run infra:plan` for the intended operations.

The cutover is one manually approved operation covering the domain, Worker and
download pointers. `infra:apply` is invoked only with the reviewed plan digest,
account and exact resource allowlist. No CI workflow, hook or package script
performs that apply automatically.

If the candidate is rejected, restore the retained FavLib site/Worker and
previous download artifact through the same manual process. Do not migrate,
delete, convert or otherwise touch the new TobiRink IndexedDB database. Record
both artifact hashes, the restored version and the reason before resuming work.
