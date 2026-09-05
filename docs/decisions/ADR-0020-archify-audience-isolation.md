---
scope:
  - .codex/hooks/archify-preview.mjs
  - .codex/hooks/stop-review.mjs
  - .githooks/archify
  - .githooks/project-policy.mjs
  - .githooks/validate-docs.mjs
  - .project/project-config.json
  - docs/architecture/**
  - docs/document-contracts.json
  - scripts/archify-registry.mjs
  - tests/archify-registry.test.mjs
  - AGENTS.md
  - README.md
  - package.json
review: on-change
---
# ADR-0020 — Archify audience isolation

- Status: accepted
- Date: 2026-09-01

## Context

The blueprint needs typed diagrams for its own governance while generated
projects need diagrams that describe only the product. Discovering every JSON
source as publishable could expose CTXRoute, Progress MCP, CRG, Sensor, Archify,
or lifecycle-hook implementation details in user-facing HTML and previews.

## Decision

Declare blueprint control-plane sources in
`architecture.internalDocuments` and product sources in
`architecture.documents`. The shared Archify registry classifies every typed
source from those explicit, disjoint lists; undeclared, overlapping, malformed,
or untyped JSON fails closed.
The `internal` selector is validation-only. Product selection, `all`, build,
preview, and visual-check exclude internal sources, and publication commands
reject product sources containing reserved blueprint control-plane names.

At the end of an architecture-relevant step, the agent chooses the product
diagram type that matches the result: architecture, workflow, sequence,
dataflow, or lifecycle. Internal validation remains part of the complete
repository gate, but it cannot create a distributable artifact.

## Consequences

The template can validate its own control plane without leaking it into product
documentation. A newly initialized project must add product sources explicitly;
an empty product registry produces no user artifact. Maintainer-only sources
remain versioned text for review and are never built or previewed.
