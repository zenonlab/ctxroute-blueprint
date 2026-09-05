---
scope:
  - package.json
  - docs/document-contracts.json
  - .project/ui-design-contract.json
  - docs/ui-design-contract.md
  - .githooks/validate-ui-design.mjs
  - .githooks/validate-decisions.mjs
  - tests/ui-design-contract.test.mjs
  - .claude/hooks/docs/ui-design-contract.md
  - tests/hooks.test.mjs
  - docs/00-project-brief.md
  - docs/02-quality-strategy.md
review: on-change
---
# ADR-0013 — Framework-neutral UI design contract

## Context

Issue #10 asks the blueprint to reduce UI duplication and slop while the
blueprint itself cannot choose a frontend framework for derived products.

## Decision

Define a versioned, framework-neutral UI contract containing design tokens,
component roles, anatomy, variants, states, slots, accessibility expectations,
and composition rules. Validate the contract in the blueprint, but defer
framework-specific component implementations and source enforcement to an
explicit product adapter.

Reusability is a declared policy: agents should reuse a contract component
before creating a custom one, and custom components require a documented
rationale. Tokens are named rather than raw values. The contract does not
modify product code, select a framework, install a UI dependency, or change
CTXRoute dispatch.

## Consequences

The blueprint gives agents a stable UI vocabulary without imposing React, Vue,
Svelte, CSS Modules, Tailwind, or another stack. Its validator can guarantee
contract integrity, but cannot claim framework-aware usage enforcement until a
derived product selects an adapter. CTXRoute may inject the contract as
guidance; Sensor remains responsible for generic structural findings.
