---
scope:
  - AGENTS.md
  - CONTRIBUTING.md
  - docs/**
  - .project/**
  - apps/**
  - packages/**
  - scripts/**
  - .github/**
review: on-change
revised: true
---
# ADR-0022 — Bounded authorization for mutating steps

- Status: accepted
- Date: 2026-09-02

## Context

Tobirink is being rebuilt surgically with the product owner. Broad autonomous
changes would collapse product decisions, provider choices, and implementation
details into changes that are difficult to review or reverse.

## Decision

Read-only inspection, research, planning, and validation may proceed without
approval. Before the first mutation, the agent proposes one bounded step with
its files or external resources, commands, risks, rollback, and acceptance
criteria. Explicit approval authorizes the listed reversible repository
mutations, documentation and Progress updates, validations, and verified
commit through completion of that step. The agent must not request another
`go` between those operations.

When the user explicitly confirms autonomous mode for a goal, the validated,
materialized steps of that goal authorize continuous execution in order without
another `go` between steps. Each step remains bounded by its recorded files,
commands, and acceptance criteria.

Approval does not carry to another step or an expanded scope. Dependency
installation must be named in the step. Provider mutation, deployment,
publication, push, deletion, secrets, costs, and any newly discovered material
decision require explicit approval. No file is deleted automatically.

## Consequences

Every change remains attributable and reviewable without turning ordinary
edits, validation, documentation, Progress evidence, and commit inside one
approved step into repeated authorization pauses. Repository automation cannot
interpret an approved autonomous goal as authority for unlisted or broader
work, and the separately confirmed operations remain gated in every mode.
