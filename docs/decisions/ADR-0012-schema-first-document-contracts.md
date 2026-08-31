---
scope:
  - docs/**
  - .project/sensor-rules.json
  - .githooks/validate-docs.mjs
  - tests/document-contracts.test.mjs
review: on-change
revised: true
---
# ADR-0012 — Schema-first document contracts

## Context

The blueprint documentation must be readable by agents without requiring
duplicated narrative explanations for every structural fact. Architecture,
decisions, quality policy, and versioned rules also need deterministic checks.

## Decision

Keep `docs/document-contracts.json` as the machine-readable registry of
document sources, formats, associated narrative documents, required sections,
and validation commands. Structured sources are authoritative for their typed
facts; Markdown is complementary context and must not silently replace the
declared source. The documentation validator checks the registry, source
existence, required Markdown sections, ADR metadata, and required JSON keys in
both the working tree and the Git index.

The registry is intentionally small and versioned. It does not attempt to
parse arbitrary prose for semantic equivalence or enforce a universal schema
for every product document. New structured contracts must be added to the
registry and receive an applicable ADR.

## Consequences

Agents can discover the documentation model from one bounded file, while
humans retain concise explanatory text. Missing or malformed document
contracts fail validation instead of being treated as complete. Token
optimization is achieved by removing duplicated facts, not by deleting
context needed to understand a decision.
