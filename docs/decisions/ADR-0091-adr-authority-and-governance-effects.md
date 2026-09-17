---
scope:
  - AGENTS.md
  - docs/decisions/**
  - scripts/agent-governance.json
  - scripts/agent-governance.mjs
  - scripts/governance-telemetry.mjs
  - .codex/hooks/problem-memory.mjs
  - .codex/hooks/post-tool-audit.mjs
  - .codex/hooks/pre-tool-architecture.mjs
  - .githooks/validate-decisions.mjs
review: on-change
supersedes:
  - ADR-0007-agent-governance-boundaries.md
  - ADR-0008-persistent-decision-metadata.md
contracts:
  - docs/decisions/README.md
---
# ADR-0091 — ADR authority and governed effects

- Status: accepted
- Date: 2026-09-17

## Decision

The primary agent owns final coherence across ADRs, executable contracts,
operational documentation, and diagrams. A worker may change an ADR only when
its durable mission file scope explicitly names that ADR or its containing
decision directory. Documentation and diagrams may change with an
implementation when they describe an unchanged decision.

An accepted decision is immutable in meaning. A changed decision is recorded
in a new ADR whose `supersedes` list names every replaced ADR. Each replaced
ADR receives only the reverse `superseded-by` metadata and the status
`superseded`. Both directions are validated. `revised: true` carries no
authority to change accepted meaning.

An editorial-only correction declares `editorial-correction: true`. It may not
change `scope`, `contracts`, `Decision`, `Consequences`, or status. PreToolUse
blocks unclassified edits to tracked accepted ADRs; PostToolUse and pre-commit
compare the working or staged content with `HEAD` and reject normative edits.

Governed effects use precise actions. `memory.observe` and bounded local
`maintenance.crg` are always allowed. `memory.resolve` and
`repository.repair` require orchestrator authority.
`memory.protection.persist` requires explicit approval bound to a
`DecisionReceipt`. Telemetry records categories and identifiers, never raw
problem content, prompts, or environment values.

## Consequences

Historical decisions remain auditable, workers cannot silently acquire
documentary authority, and an already-present `revised: true` field cannot
bypass review. Bounded observation is distinct from durable protection.
