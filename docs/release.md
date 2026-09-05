# Extension packaging and rollback

## Build a release candidate

Run `npm run package:extension` from the repository root. The command rebuilds
both browser targets and writes these ignored, reproducible artifacts:

- `apps/extension/.output/packages/tobirink-chrome-mv3-<version>.zip`
- `apps/extension/.output/packages/tobirink-firefox-mv3-<version>.zip`
- `apps/extension/.output/packages/release-manifest.json`

ZIP entries are sorted, compressed with a fixed level and carry a fixed DOS
timestamp. The packager creates each archive twice in memory and refuses a byte
difference. The manifest records target, version, file count, byte size and
SHA-256.

Packaging is local only. It never signs, uploads, publishes, deploys, edits a
store listing or handles store credentials. Submission remains a separate
manual operation after the browser checks in `docs/browser-support.md` pass.

## Release verification

1. Run `npm run package:extension`.
2. Run `npm run verify` and retain its output with the release candidate.
3. Compare each ZIP SHA-256 with `release-manifest.json` before transfer.
4. Load the exact ZIP in the matching browser and complete the manual journeys.
5. Retain the accepted ZIP and manifest outside the generated build directory
   before creating the next version.

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
