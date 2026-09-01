---
scope:
  - .githooks/ast-registry.mjs
  - .githooks/sensor-engine.mjs
  - .githooks/sensor-languages.mjs
  - .githooks/sensor-checklist.mjs
  - .project/project-config.json
  - tools/oxlint/anti-slop/
  - oxlint.config.ts
  - docs/architecture/src/sensor.dataflow.json
review: on-change
revised: true
contracts:
  - package.json
  - package-lock.json
---
# ADR-0021 — Honest multilingual Sensor packs

- Status: accepted
- Date: 2026-09-01

## Decision

The Sensor v2 catalogue classifies all 115 extensions and 9 filenames,
including Astro and Jupyter notebooks, but separates recognition from syntax
support. `PASS` requires a grammar or a real
structured parser loaded on Node 22. Extractors and lexical checks report
`PARTIAL`; formats without a verified parser report `MISSING`; irrelevant
capabilities report `N/A`. A lexical fallback can never become syntax-aware.

Projects declare required languages under `quality.sensor.languages`. A missing
required parser is an `ERROR` with the exact pack command. Ad hoc recognized
files may receive a clearly labelled lexical fallback and warning. Sensor JSON
schema 2 retains the verdict and diagnostics contracts and adds per-file
language, parser, syntax-awareness, and capability evidence.

Language packs are managed only by `sensor:languages`. Identifiers and package
names come from the catalogue, versions and checksums are exact, the npm
lockfile is checked, and failed mutations restore project configuration,
package manifest, and lockfile. `qualify` executes valid, invalid, and located
fixtures in a temporary workspace. Presets expose `READY` or `BLOCKED` and are
rejected before mutation when any pack lacks complete evidence. Setup runs
`sync`; hooks and scans never install dependencies.

Parser ASTs are projected into a normalized IR covering imports, calls,
arguments, assignments, literals, interpolation, error blocks, HTML elements,
and attributes. Composite scripts are materialized only in an ephemeral
workspace for one official Oxlint batch, then diagnostics are mapped to host
coordinates. Vue, Svelte, Astro, HTML/template scripts, and notebook code cells
share this mapping boundary.

Official anti-slop source is vendored from immutable commit
`e8c4880471b23ab7f216fba7b27d173a6ef07d4c` with MIT licence, checksum,
provenance and a separate local-adaptation journal. Oxlint and
`@oxlint/plugins` are both `1.78.0`. The 15 generic rules run once per JS/TS
batch as blocking `anti-slop/*` diagnostics. The optional Effect plugin is
enabled only by direct `effect` dependency in `auto` mode, or by explicit
policy. Blueprint-specific heuristics use `sensor/quality/*` identifiers.

## Consequences

Current stable syntax support is intentionally narrower than recognition:
JavaScript/JSX, TypeScript/TSX, Python, Ruby/ERB, and structured JSON. Other
catalogue entries remain visible as `PARTIAL` or `MISSING` until a compatible
parser and fixture matrix are added. Presets containing an unavailable parser
fail before mutation instead of pretending installation succeeded.

The blueprint baseline has no exceptions. The 69 pre-existing
`anti-slop/no-runtime-typeof` errors and the commit-message path false positive
were removed. Stale entries and all unexpected blocking diagnostics fail the
gate.

Vendored anti-slop sources remain covered by their functional Sensor fixtures,
but are excluded from the blueprint's aggregate Node coverage threshold. That
threshold measures maintained integration code rather than imported upstream
implementation details.

## Alternatives

Keeping broad lexical adapters as `PASS` would preserve false confidence.
Installing packages inferred from user input would create a package-injection
boundary. Downloading upstream rules during setup or CI would make policy
non-reproducible.
