---
scope:
  - .codex/hooks/**
  - .githooks/**
  - docs/decisions/**
  - package.json
  - package-lock.json
contracts:
  - package.json
  - "*.lock"
review: on-change
revised: true
---
# ADR-0008 — Persistent decision metadata and priority

- Status: accepted
- Date: 2026-08-30

## Context

Durable decisions were readable but not addressable by lifecycle hooks.

## Decision

Every ADR except the authoring template carries YAML front matter with a
non-empty `scope`, optional `contracts`, and a `review` policy. Scope uses
repository-relative exact paths and `*`/`**` globs. Applicable ADRs are
injected in numeric filename order before a matching change. An ADR marked
`superseded-by` remains in the corpus and is not injected; a revised ADR uses
`revised: true` and remains the source of truth.

PreToolUse blocks architectural and contract changes with no applicable valid
ADR. PostToolUse repeats the check and validates modified decisions. Tests and
generated files are exempt from the architectural requirement.

## Alternatives

Inferring decisions from commit messages is not deterministic. Automatic ADR
creation would hide important human-readable architectural choices.

## Consequences

Hooks provide durable context and explicit failures while contributors retain
ownership of writing and revising decisions. Metadata is intentionally a small
YAML subset so no runtime dependency is required.
