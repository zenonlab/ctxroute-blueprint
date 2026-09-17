---
scope:
  - package.json
  - package-lock.json
  - .github/dependabot.yml
  - .github/workflows/**
  - tests/ci-security.test.mjs
review: on-change
contracts:
  - README.md
  - docs/ci.md
---
# ADR-0093 — Qualified dependency and CI action updates

- Status: accepted
- Date: 2026-09-17

## Decision

GitHub Actions and development dependencies may advance through pinned,
reviewed updates when the complete repository gate remains green. Workflow
tests bind security-sensitive Actions to their reviewed immutable commits, and
job names identify the Node.js 24 reference runtime used by CI.

Tree-sitter runtime and grammar packages remain fixed at the versions recorded
by the AST compatibility proof. Dependabot ignores those packages until the
dedicated `ast:update --apply` qualification matrix can advance the manifest,
lockfile, registry, checksums, and compatibility evidence together.

## Alternatives

Allowing the grouped dependency update to advance Tree-sitter independently
was rejected because package availability alone does not prove parser,
fixture, position, rule, or platform compatibility. Keeping deprecated Action
majors was rejected because it leaves avoidable runner warnings and stale
runtime dependencies.

## Consequences

Routine tooling and Actions stay current without weakening immutable pins.
Parser upgrades remain deliberate and may lag general development dependency
updates until their compatibility evidence is regenerated and reviewed.
