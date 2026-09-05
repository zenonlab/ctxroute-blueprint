# Extension performance evidence

Date: 2026-09-04

## Budgets

Tobirink applies the release budgets defined in the project brief and quality
strategy: representative local UI work below 200 ms, no unbounded storage scan
or network dependency during background startup, and each browser package below
1.5 MB compressed.

## Reproducible gate

Run `npm run test:performance`. The command rebuilds Chromium and Firefox before
measurement so stale output cannot satisfy the gate. The test then:

- renders the library, Review and agenda React surfaces from local
  serializable state and checks each render against the 200 ms reference budget;
- recursively inspects all 19 generated files per target and sums the gzip size
  of every file as a deterministic compressed-size proxy;
- inspects the background entrypoint and rejects startup fetches, IndexedDB
  reads, collection materialization, intervals and timeouts.

This is a build-time regression guard. It does not claim browser paint or input
latency; those measurements belong to the manual Chromium and Firefox release
pass documented in `docs/ui/accessibility-evidence.md`.

## Recorded result

The 2026-09-05 reference run passed all three checks. Local render timings are
emitted by the reproducible gate for library, Review and agenda. The generated
Chromium and Firefox packages contain 19 files each. Their exact raw and
gzip-proxy sizes are emitted by `npm run test:performance`; both remain below the
1.5 MB compressed budget, and the startup scan/network check passed.
