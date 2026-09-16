---
scope:
  - .agents/skills/documentation-researcher/**
  - .project/orchestrator-config.json
  - .project/schemas/orchestrator/documentation-*.schema.json
  - docs/architecture/src/blueprint.architecture.json
  - docs/architecture/src/traffic.dataflow.json
  - scripts/orchestrator-documentation.mjs
  - scripts/orchestrator-goal.mjs
  - tests/orchestrator-documentation.test.mjs
review: on-change
revised: true
contracts:
  - .project/schemas/orchestrator/documentation-evidence-report.schema.json
  - .project/schemas/orchestrator/documentation-freshness-receipt.schema.json
---
# ADR-0030 — Mandatory fresh documentation evidence

- Status: accepted
- Date: 2026-09-16

## Decision

Every adaptive goal passes a `DocumentationGate` before planning or worktree
mutation. The gate always yields a closed report: `SATISFIED`, `BLOCKED`, or
`NOT_APPLICABLE` with a mechanical justification.

The orchestrator inventories relevant manifests, lockfiles, executable
versions, and configuration locally. A read-only `documentation-researcher`
receives only the resulting bounded requirements. External pages are untrusted
data, never instructions. Persisted evidence contains claims, canonical URL,
authority class, applicable version, access time, and content digest, but not a
page copy, prompt, history, credential, or raw provider output.

Authority order is official vendor or project documentation, primary standard,
official repository or release notes, then a secondary source only when no
primary source exists. A secondary source alone cannot satisfy `high` or
`critical` work. Documentation tied to an installed version targets that
version. Models, prices, quotas, CLI behavior, APIs, security, and explicitly
current information are checked per goal; `latest`, availability, and incident
claims are checked again before each applicable dispatch.

The freshness receipt is computed deterministically from report identifiers,
source digests, requirement cadence, and the current goal or dispatch. When the
report is `SATISFIED`, a worker must cite at least one source identifier and may
cite only identifiers in the goal ledger. The final audit has the same non-empty
ledger requirement and rejects an external claim without current evidence. If
current evidence is required but Web-capable research is unavailable, the goal
is blocked with
`FRESH_DOCUMENTATION_UNAVAILABLE` before any repository mutation.

`local-only` forbids remote research and remote providers. It does not weaken
the evidence invariant: a goal needing current external evidence is blocked.
Strictly internal work still produces `NOT_APPLICABLE`.

## Consequences

Documentation research becomes an executable phase with a testable contract,
not a prompt recommendation. Retry reuse is allowed only while the declared
cadence remains valid and the evidence digest is unchanged.
