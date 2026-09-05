---
scope:
  - .codex/**
  - .claude/**
  - .githooks/**
  - .project/**
  - .github/**
  - scripts/**
  - tests/**
  - docs/ci.md
  - package.json
  - package-lock.json
review: on-change
---
# ADR-0027 — Migrate the blueprint control plane without reinstalling Tobirink

- Status: accepted
- Date: 2026-09-03

## Context

Tobirink was initialized from CTXRoute Blueprint at product commit `c53fad3`,
after upstream commit `458f8b9`. The target blueprint revision is
`abd9d8e67d9a525998a769e6d260629614fb63f3`. The intervening 20 non-merge
commits primarily change Progress editing and concurrency, the local dashboard,
hook behavior, project-policy validation, and their tests.

Reinstalling the template would confuse upstream control-plane defaults with
Tobirink's product state. It could overwrite accepted ADRs, the initialized
project configuration, product-only diagrams, and the persistent progress
history.

## Decision

Migrate through Git history from the pinned upstream revision. Do not reinstall
or copy the complete template over Tobirink. Integrate one approved step at a
time and keep the migration reversible through dedicated verified commits.

Adopt upstream implementations for the Progress core and dashboard, MCP and
hook fixes, portable initialization behavior, project-policy additions, and
their focused tests. Preserve Tobirink's product documents, ADRs, Archify
sources, UI decisions, sensor language selection, and initialized status.

Resolve mixed files explicitly:

- `.project/project-config.json` keeps the Tobirink decisions and paths, remains
  `initialized`, and gains only newly required schema fields such as bounded
  documentation roots and extensions.
- `.project/progress.json` keeps every Tobirink goal and its evidence. Structural
  changes use the Progress API; the upstream template checklist never replaces
  it. `docs/progress.md` remains a generated view.
- `.project/ui-design-contract.json` and `.project/sensor-baseline.json` retain
  approved product values while accepting compatible schema or validator
  updates.
- Tests combine the new upstream behavior with Tobirink's lifecycle-aware
  initialization fixtures; neither side is accepted wholesale when both changed
  the same contract.

Generated CTXRoute state and mirrored ADR memory are not authoritative migration
inputs. They are neither committed as new sources nor deleted automatically.
Product Archify diagrams must never expose blueprint control-plane components;
internal blueprint diagrams remain separately validated.

Before integration, require a clean conflict inventory and preserve all current
tracked changes. During integration, inspect every conflict and every deletion.
If the merge is uncommitted, rollback uses `git merge --abort`. After a verified
migration commit, rollback uses a dedicated revert commit rather than history
rewriting.

## Alternatives

A fresh template followed by manually copying product files has a larger
overwrite surface and loses useful ancestry. Replacing all conflicted files with
either the local or upstream version would silently discard valid behavior from
the other side. Rebasing the initialized product commit is possible, but offers
no advantage over an explicit merge and makes review of the integration less
direct.

## Consequences

The migration requires deliberate conflict resolution, especially for project
configuration, progress state, and initialization tests. In return, Tobirink
keeps its product history and decisions while gaining the new blueprint tools.
Each later mutating step still requires its own explicit user approval under
ADR-0022.
