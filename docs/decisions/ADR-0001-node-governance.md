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

Use Node.js and npm for template orchestration: CTXRoute, governance hooks,
governance tests, Sensor, and Archify. Official CRG is a separate frozen Python
3.10+ project managed by uv 0.11.2. Keep product stack decisions separate in
`.project/project-config.json`.

Expose `npm run setup` as the single cross-platform bootstrap command. It uses
both lockfiles, installs the exact CRG environment, builds the initial graph,
enables repository-local Git hooks, and runs the full validation suite.

During `template` status, PreToolUse allows the blueprint's read-only and
validation commands, including workspace, governance, progress-read,
progress-validate, Sensor checklist checks, and CRG commands whose writes are
confined to ignored `.code-review-graph/`. Progress approval and unrelated
long-lived or direct mutation commands remain blocked.

Before initialization, traceable editing tools may also create documentation
inside the declared `documentation.roots` when its suffix appears in the
bounded `documentation.extensions` allowlist. The default roots are `docs/`,
`documentation/`, and `specs/`; executable documentation formats such as MDX
are excluded. Shell writes remain blocked regardless of the file extension.

The template-to-initialized transition is owned by `npm run initialize`. It
requires completed decisions, brief, quality strategy, and passing validation;
direct edits to the status field are rejected by PreToolUse.
Initialization recognizes unresolved square-bracket placeholders while allowing
ordinary Markdown links. Repository tests derive lifecycle expectations from
the current project configuration or isolated fixtures, so adding a product
diagram or progress checklist cannot make the pre-transition validation
impossible.
The transition invokes the exact npm CLI supplied by `npm run` through the
current Node executable, avoiding direct `.cmd` execution on Windows.

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
