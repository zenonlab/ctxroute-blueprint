---
scope:
  - packages/code-review-graph/**
  - scripts/crg-*.mjs
  - scripts/validate-mcp-installation.mjs
  - .codex/hooks/**
  - .codex/config.toml
  - .mcp.json
  - .github/**
  - .project/**
  - docs/**
  - package.json
  - package-lock.json
review: on-change
revised: true
supersedes:
  - ADR-0006-ephemeral-crg-pipeline.md
  - ADR-0016-ast-context-mcp.md
---
# ADR-0018 — Official code-review-graph and MCP governance

- Status: accepted
- Date: 2026-09-01

## Context

The blueprint had two overlapping code-context systems: an internal AST MCP
and an unpinned `uvx` CRG updater backed by a synthetic SQLite journal. This
duplicated Tree-sitter analysis, did not install a reproducible CRG runtime,
and did not expose the official graph tools.

## Decision

Use official `tirth8205/code-review-graph` v2.3.8 from tag `v2.3.8`, commit
`2c6dae32643572ee528eb9b77dbcc17f58f3a8c9`. A Python project supporting
3.10+ is locked with uv 0.11.2; Python 3.12 is the reference runtime. Every
local invocation uses `uv run --project packages/code-review-graph --frozen`.
The official graph at `.code-review-graph/graph.db` and the project virtual
environment are ignored.

CTXRoute remains the sole lifecycle dispatcher. SessionStart checks or builds
the graph and injects a short usage instruction. Successful normal writes run
one `update --skip-flows` behind a cross-process single-flight lock, a
30-second timeout, bounded output, and fail-open diagnostics. No CRG daemon,
watcher, generated CRG hooks, or synthetic update database is used.

The only project MCP servers are Progress and official code-review-graph. The
CRG MCP default exposure is an exact six-tool allowlist: minimal context,
impact radius, graph query, review context, graph stats, and architecture
overview. Build, refactor, embedding, wiki, and secondary exploration remain
available through controlled CLI commands when needed. The MCP schema budget
is kept below 8,000 characters for CRG and 14,000 characters combined with
Progress.
The Sensor keeps its own pinned Tree-sitter registry solely for security
checks. `apply_refactor_tool` is allowed only with `dry_run: true`; accepted
changes use normal editors so architecture, Sensor, and audit hooks remain in
the mutation path.

Embeddings are never generated automatically. Local embeddings require an
explicit optional installation and command. Cloud providers additionally
require their documented environment variable and
`CRG_ACCEPT_CLOUD_EMBEDDINGS=1`; secrets and provider configuration are never
versioned.

PR review uses the official Action pinned to the same commit. The untrusted PR
workflow has read-only contents permission and uploads a bounded report. A
separate trusted `workflow_run` workflow never checks out PR code, validates
the unique artifact and analyzed SHA, neutralizes mentions, and alone receives
comment permission. The official Action's internal Actions are transitive
release dependencies reviewed when the CRG commit pin changes.

## Consequences

CRG is a mandatory setup dependency, while graph state remains local and
generated. The custom AST context MCP, tokenizer benchmark, watcher, and fake
database are removed. CRG failures remain visible without blocking agents;
the PR risk gate remains blocking at the official `high` threshold of 0.70.
