---
scope:
  - .github/**
  - .devcontainer/**
  - .githooks/setup.mjs
  - docs/ci.md
  - package.json
  - scripts/**
contracts:
  - package.json
  - .project/project-config.json
review: on-change
---

# ADR-0015 — Installation and CI boundary

- Status: accepted
- Date: 2026-08-31

## Context

The blueprint must be usable immediately after GitHub generation without
selecting or initializing an application stack. GitHub cannot run npm during
repository creation, while CI and Codespaces can install dependencies after a
checkout.

## Decision

Keep `npm run setup` as the single local bootstrap. Run it in Codespaces after
creation and in CI on push and pull request. CI uses Node 22, minimal read
permissions, pinned action SHAs, explicit validation stages, and uploads only
sanitized Archify/Sensor/summary artifacts. The blueprint's CD means optional
publication of documentation artifacts; it does not deploy an application.

Use a separate derived-project workflow for product deployment, secrets,
environments, rollback, and provider-specific checks.

## Consequences

Local clones require one explicit command. Codespaces and CI install
automatically. The repository remains `template`, stack-neutral, and free of
product cloud resources. Diagnostics must not include secrets or sensitive
absolute paths.
