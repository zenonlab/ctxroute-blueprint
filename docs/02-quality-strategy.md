# Quality strategy

## Test matrix

| Type | Required? | Tool | Command | Rationale |
| --- | --- | --- | --- | --- |
| Unit | yes | Node.js built-in test runner | `npm test` | Event coalescing, process lifecycle, permissions, and pure helpers. |
| Integration | yes | Node.js built-in test runner | `npm test` | Watcher-to-runner behavior with fake commands and temporary SQLite files. |
| End-to-end | no | — | — | No deployed product runtime exists. |
| Contract | yes | Node.js assertions | `npm test` | JSON diagnostics, workspace scripts, and governance outcomes. |
| Property | no | — | — | The bounded orchestration logic is small and example-driven. |
| Snapshot | no | — | — | Stable JSON is asserted structurally. |
| Performance | yes | Node.js timers and process limits | `npm test` | Coalescing and single-flight behavior under bursts. |
| Security | blueprint infrastructure | tree-sitter Sensor, markup adapters, risk rules, lexical registry, SARIF export, and staged-blob validation | `npm run sensor -- <paths>` or `node .githooks/sensor --checklist --json` | AST/lexical diagnostics, application-risk rules, explicit-path module boundary, SARIF contract, staged `UNSAFE`/`ERROR` blocking, and declared no-runtime-proof coverage |
| UI contract | yes | JSON contract validator | `npm run validate:ui` | Framework-neutral tokens, reusable component vocabulary, explicit states, accessibility expectations, and optional product adapters |
| Progress contract | yes | Node.js assertions | `npm test` | Bounds, safe paths, evidence references, read-only validation, atomic approval, idempotence, generated view, and shared CLI/MCP core. |
| Mutation | no | — | — | No mutation runner is installed; critical behavior is covered by integration tests. |

## Decision rule

Unit, integration, contract, and performance checks run on every change through
`npm test` and CI. Architecture, documentation, configuration, CTXRoute, and
Sensor checks remain part of `npm run validate`. Security behavior is covered
by the existing Sensor suite and governance tests. Mutation testing is
explicitly disabled because no mutation runner is installed.

The mutation decision is recorded in `.project/project-config.json`; hooks do
not run mutation testing. PostToolUse integration tests cover path extraction,
multi-language ordering, CTXRoute context transmission, explicit unsupported
files, and the boundary that prevents policy or global configuration changes.
The UI contract is validated independently of any frontend framework; framework
usage enforcement is deferred until a derived product selects an adapter.
