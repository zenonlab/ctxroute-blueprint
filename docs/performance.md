# Extension performance evidence

Date: 2026-09-08

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

The FavLib correction gate passes four performance checks. The isolated
20-file Chrome ZIP is 273,208 bytes and the Firefox ZIP is 273,254 bytes;
independent builds reproduce both archives exactly. These measurements cover
the configured site origin and remain below the 1.5 MB package budget.

The resolution runner checks its 20-second slice budget before claiming the
next task. This is a cooperative scheduling bound, not an enforced deadline
for an in-flight request or the complete inventory/recovery wake. A complete
latency distribution on the real FavLib corpus is still unavailable and is
not inferred from the installed synthetic journeys.

The 2026-09-05 reference run passed all three checks. Local render timings are
emitted by the reproducible gate for library, Review and agenda. The generated
Chromium and Firefox packages contain 19 files each. Their exact raw and
gzip-proxy sizes are emitted by `npm run test:performance`; both remain below the
1.5 MB compressed budget, and the startup scan/network check passed.
