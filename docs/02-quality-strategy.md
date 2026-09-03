# Quality strategy

Choose the project’s quality strategy during construction. The matrix below
keeps the decision open while giving the agent enough context to recommend a
proportionate level of verification.

## Test matrix

| Type | Project choice | Questions to answer | Evidence |
| --- | --- | --- | --- |
| Unit | required | Governance, Sensor, and progress rules | `npm run test:coverage` passes 85% lines, 70% branches, and 85% functions |
| Static lint | required | JavaScript tooling and tests | `npm run lint` and the vendored official anti-slop batch must pass |
| Integration | required | npm install, frozen CRG sync/MCP, CTXRoute, Archify restore, hooks, and workspace boundaries | `npm run setup`, `npm run crg:smoke`, and `npm run integration` |
| End-to-end | required for local tooling | The Progress dashboard crosses browser-style HTTP, MCP, detached-process, and filesystem boundaries | `node --test tests/progress-dashboard.test.mjs tests/mcp-stdio.test.mjs tests/hooks.test.mjs` |
| Contract | required | Six lifecycle events, project config, Archify IR, docs, hooks, and Sensor JSON/SARIF | `npm run validate` |
| Property / fuzz | recommended | Path guards, command parsing, MCP input, and Sensor source parsing | Keep adversarial fixtures deterministic; add generated properties when an input grammar expands |
| Performance | required | CRG updates remain single-flight, time-bounded, and output-bounded | runner unit tests plus `npm run crg:smoke` |
| Security | required | Minimal CI permissions, pinned actions, whole-blueprint Sensor gate, no secret diagnostics | `npm audit --audit-level=high`, `npm run sensor:blueprint`, and the Sensor checklist |
| Accessibility | required for local tooling | Progress remains keyboard-operable, labelled, responsive, status-announced, and confirmation-gated; generated Archify HTML remains documentation infrastructure | Dashboard HTML contract tests plus 9/9 Archify showcase checks and `npm run archify:visual-check` |
| Migration / recovery | not applicable | No product data or deployment is owned by the blueprint | Derived project decision |

## Template baseline

The blueprint itself validates its governance, architecture evidence, document
contracts, UI contract, Sensor diagnostics, and cross-platform tooling. These
checks protect the template infrastructure; they do not replace the derived
project’s product tests. Keep only the baseline checks that remain relevant
after initialization and add product-specific checks beside them.

## Decision rule

Select the smallest test strategy that covers the product’s failure cost and
change risk. Increase rigor when the project handles sensitive data, has public
or adversarial inputs, crosses process or network boundaries, or has expensive
failure recovery. Every required check must have a runnable command, a clear
owner, and an acceptance threshold.

The project brief records the chosen strategy. Durable security, dependency,
contract, or major quality constraints belong in an ADR.

## Sensor and CRG boundary

The Sensor v2 catalogue classifies recognition, parsing, common rules, and
ecosystem rules separately. JavaScript, TypeScript/TSX, Python, Ruby/ERB, and
JSON have verified syntax parsing. Other formats are `PARTIAL` or `MISSING`
until their Node 22 parser and valid/invalid fixture matrix are verified. Astro
and notebook cells are recognized composite sources with host diagnostic
mapping, but remain `PARTIAL` until their own parser packs are qualified. A
fallback reports itself and never claims syntax-aware coverage.

`npm run sensor:languages -- qualify --json` runs parser fixtures in a temporary
workspace without changing project manifests. Pack and preset status includes
provenance, checksum, platform evidence, `READY`/`BLOCKED`, and exact blocking
reasons. A blocked preset performs no mutation. The blocking anti-slop baseline
is empty; stale exceptions and new blocking diagnostics fail validation, and
`npm run lint:anti-slop` is part of `npm run validate`.
The vendored official JS/TS anti-slop rules keep `anti-slop/*` IDs; common
blueprint heuristics use `sensor/quality/*`.

Official CRG supplies code context and impact analysis through its own graph
and MCP; it never replaces the blocking Sensor. Run `npm run ast:check` for
Sensor grammar compatibility and `npm run crg:smoke` for the exact CRG version,
fixture build, incremental update, transport, tool list, and read call.
