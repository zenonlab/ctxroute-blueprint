# Quality strategy

Choose the project’s quality strategy during construction. The matrix below
keeps the decision open while giving the agent enough context to recommend a
proportionate level of verification.

## Test matrix

| Type | Project choice | Questions to answer | Evidence |
| --- | --- | --- | --- |
| Unit | required | Governance, Sensor, and progress rules | `npm run test:coverage` passes 85% lines, 70% branches, and 85% functions |
| Static lint | required | JavaScript tooling and tests | `npm run lint` must pass with the pinned ESLint configuration |
| Integration | required | npm install, CTXRoute, Archify restore, hooks, and workspace boundaries | `npm run setup` and `npm run integration` |
| End-to-end | not applicable | The blueprint has no product UI or runtime | No product deployment |
| Contract | required | Six lifecycle events, project config, Archify IR, docs, hooks, and Sensor JSON/SARIF | `npm run validate` |
| Property / fuzz | recommended | Path guards, command parsing, MCP input, and Sensor source parsing | Keep adversarial fixtures deterministic; add generated properties when an input grammar expands |
| Performance | required | Context summaries stay bounded; CRG watcher remains single-flight | `npm run context:benchmark:check` enforces the versioned ratio, token, and duration budgets |
| Security | required | Minimal CI permissions, pinned actions, whole-blueprint Sensor gate, no secret diagnostics | `npm audit --audit-level=high`, `npm run sensor:blueprint`, and the Sensor checklist |
| Accessibility | not applicable | Generated Archify HTML is documentation infrastructure only | Validate artifact structure |
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

## AST Sensor and context boundary

The Sensor and Context MCP share one executable registry and pinned Tree-sitter
grammars for JavaScript, TypeScript/TSX, Python, and Ruby. ERB uses embedded
Ruby extraction without changing source offsets. PHP and grammar-free formats
remain explicitly lexical or embedded. Diagnostics report the actual mode,
grammar, and any fallback reason.

The separate Context MCP provides bounded symbols, summaries, definitions,
syntax-aware references, and relevant context. It rejects path escapes,
ignored/generated paths, and mixed product/blueprint scopes. Responses are
counted with `gpt-tokenizer@4.0.0` and structurally truncated. Run
`npm run ast:check`, `npm run integration`, and `npm run
context:benchmark:check` for the corresponding mechanical evidence. The
thresholds in `.project/context-benchmark.json` are repository regression
budgets rather than universal performance claims.
