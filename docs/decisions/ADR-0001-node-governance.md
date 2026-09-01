---
scope:
  - .codex/**
  - .githooks/**
  - package.json
  - package-lock.json
review: on-change
revised: true
---
# ADR-0001 — Node.js for template governance

- Status: accepted
- Date : 2026-08-24

## Context

The template must validate its hooks, configuration, and diagrams without
imposing a technology stack on derived products.

## Decision

Use Node.js and npm only for template infrastructure: CTXRoute, governance hooks,
governance tests, and Mermaid. Keep product stack decisions separate in
`.project/project-config.json`.

Expose `npm run setup` as the single cross-platform bootstrap command. It uses
the lockfile, installs Mermaid's browser explicitly, enables repository-local
Git hooks, and runs the full validation suite.

During `template` status, PreToolUse allows the blueprint's read-only and
validation commands, including workspace, governance, progress-read,
progress-validate, and Sensor checklist checks. Progress approval, MCP startup,
CRG updates, and the CRG watcher remain blocked because they mutate state or
start a long-lived process.

The template-to-initialized transition is owned by `npm run initialize`. It
requires completed decisions, brief, quality strategy, and passing validation;
direct edits to the status field are rejected by PreToolUse.

## Alternatives

Shell-only tooling would reduce dependencies but weaken portability and
testability. Reimplementing Mermaid validation would add unjustified complexity.

## Consequences

Node.js 22.13+ and npm 10+ are explicit template prerequisites because CTXRoute
requires Node.js 22+. The maintained Node 22 floor also supports the pinned
ESLint major. These tooling constraints do not determine the language, runtime, or
architecture of a derived product.

Setup changes only repository-local state and dependency caches. It never edits
global agent settings, deletes project files, or creates commits.

The template command allowlist is explicit rather than derived from every npm
script, so adding a future script cannot silently weaken the discovery boundary.
