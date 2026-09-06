# Validation evidence

This record separates executed commands from code inspection and external
analogy. The first table preserves the 2026-09-06 pre-remediation audit. Current
handoff evidence is appended separately so historical observations are not
silently rewritten.

## Environment

- Repository: `/Users/hazenawsky/test/ctxroute-blueprint`
- Branch/base: `main`, `eb4b822`
- Audit date/timezone: 2026-09-06, Europe/Paris
- Observed tools: Node `v24.18.0`, npm `11.16.0`, Git `2.52.0`
- Project support contract remains Node `>=22.13.0`, npm `>=10` (`package.json:15-18`); local versions are not a substitute for the CI Node 22 matrix.

## Commands and results

### Pre-remediation audit

| Command | Result | What it proves |
| --- | --- | --- |
| `git status --short` before work | PASS, empty | No pre-existing working-tree changes were observed at audit start. |
| `node --test tests/orchestrator-core.test.mjs tests/session-audit.test.mjs tests/mcp-stdio.test.mjs tests/architecture-hook.test.mjs` | PASS: 49 tests, 0 failures, about 3.55 s | Current targeted orchestration, audit, MCP and governance fixtures pass. |
| `npm run validate:docs -- --all` | PASS | Existing docs and registry passed before additions; rerun below covers deliverables. |
| `npm run skills:validate` | PASS | Three current skill manifests/companions satisfy the implemented static validator. |
| `npm run validate:decisions` | PASS: 24 decisions, 178 scopes | ADR syntax/scope validator passes; it does not detect duplicate numeric IDs or semantic contradictions. |
| `node --test tests/document-contracts.test.mjs` | PASS: 8 tests | Current document registry happy-path and repeatability tests pass. |
| `npm run verify` | PASS: 230 tests (229 passed, 1 skipped), coverage 91.24% lines / 74.79% branches / 90.60% functions; 0 npm vulnerabilities; CRG/MCP/integration/docs build passed. | Full repository release gate, including document validation, tests, audits and doc build. The Sensor gate passed with seven non-blocking warnings and no unexpected blocking diagnostic. |

External discovery used official-source web searches and direct reads for JSON Schema, OpenAPI, Kubernetes, Flux/OpenGitOps, Git, Node, GitHub Actions, Bazel/Google testing and Epsilon3. The source ledger and access limitations are in [external-research.md](external-research.md).

### Governance remediation

| Command | Result | What it proves |
| --- | --- | --- |
| `node --test tests/decision-memory.test.mjs tests/ci-security.test.mjs` | PASS: 11 tests, 0 failures | Duplicate ADR numbers and missing supersession targets reject; CRG is pinned, read-only, and blocking at `high`. |
| `npm run validate:decisions` | PASS: 25 active decisions, 163 scopes at this checkpoint | The active ADR corpus has unique numeric identifiers and valid supersession references; retired ADRs are outside that corpus. |
| `npm run validate:docs -- --all` | PASS | Updated active documentation and local links satisfy the document-contract checks. |

The full command set and final counts belong to the release handoff after all
implementation milestones converge. The closure matrix in
[remediation-closure.md](remediation-closure.md) defines that gate.

## Proof limits

- Passing fixtures prove only their assertions and environment. They do not prove absence of other failure modes.
- The targeted orchestration suite uses real temporary Git repositories and predetermined reports, but does not inject network calls, LLM calls, timeouts, kill signals or multi-process races (`tests/orchestrator-core.test.mjs:145-161`).
- Atomic rename behavior is code-observed; abrupt power-loss durability was not tested.
- The original “no runtime modification” result applies only to the audited
  `eb4b822` diff. Remediation intentionally changes runtime and governance.
- No remote GitHub Actions run was triggered. Local validation cannot prove repository settings, branch protection, hosted-runner behavior or secrets configuration.
- No Epsilon3 product instance was accessed. Publisher claims remain analogies.
- No HTTP application flow was found in the current orchestrator. Historical Progress/dashboard documentation is explicitly classified as stale documentation, not implementation.
