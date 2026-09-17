---
scope:
  - .codex/**
  - .githooks/**
  - package.json
  - package-lock.json
  - packages/*/package.json
  - scripts/check-workspaces.mjs
  - .github/workflows/validate.yml
  - tests/ci-security.test.mjs
review: on-change
supersedes:
  - ADR-0001-node-governance.md
contracts:
  - README.md
  - CONTRIBUTING.md
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/ci.md
---
# ADR-0094 — Tested Node.js runtime floor

- Status: accepted
- Date: 2026-09-17

## Decision

The template control plane requires Node.js 22.18 or newer and npm 10 or newer.
Node.js 24 remains the reference runtime. A dedicated Linux CI job installs the
pinned dependencies and runs setup checks, official anti-slop rules, and the test
suite on exactly Node.js 22.18.0.

## Alternatives

Keeping Node.js 22.13 was rejected because Oxlint 1.82 loads the vendored official
TypeScript plugins through Node and requires Node.js 22.18 or newer for native
TypeScript module loading. Converting the immutable vendored rule sources to
JavaScript was rejected because it would weaken their provenance and increase
maintenance risk.

## Consequences

The documented runtime floor matches executable behavior and is continuously
verified. Dependency updates must keep both the Node.js 24 reference gate and the
Node.js 22.18 compatibility job green.
