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

The project lifecycle remains local and minimal. CRG builds and updates are
explicit or scheduled through the lifecycle dispatcher's asynchronous
`maintenance` lane, outside the synchronous per-tool path. The lane accepts
only successful editor writes, coalesces edit bursts, and runs behind a
cross-process single-flight lock, a 30-second timeout, bounded output, and
fail-open diagnostics. Its plan is validated for both Codex and Claude; it is
not inferred from a comment or a benchmark flag. No CRG daemon, watcher,
generated CRG hooks, or synthetic update database is used.

Graph freshness is part of the public local contract. `npm run crg:health`
compares the graph build commit with repository `HEAD` and emits a bounded JSON
receipt. A stale or missing graph reports `npm run crg:update` as the single
deterministic remediation. When the official incremental updater reports zero
changed files and therefore retains a parent commit after a merge, the runner
performs one bounded full build to bind graph metadata to the current `HEAD`.
MCP consumers continue to receive the official graph metadata and must not
treat stale or unindexed responses as useful context.

The only project MCP servers are the CTXRoute orchestrator and official code-review-graph. The
CRG MCP default exposure is an exact six-tool allowlist: minimal context,
impact radius, graph query, review context, graph stats, and architecture
overview. Build, refactor, embedding, wiki, and secondary exploration remain
available through controlled CLI commands when needed. The MCP schema budget
is kept below 8,000 characters for each server and 16,000 characters combined.
For relational code questions, coding agents use CRG before native text and
file tools: minimal context first, then at most the targeted impact, review,
query, or architecture operation needed by the task. Native search and reads
remain the confirmation path for exact text, exact lines, unsupported or
unindexed files, and deterministic validation. SessionStart, PreCompact, and
bounded worker prompts all carry this policy so it survives compaction and
applies to orchestrated subprocesses. A stale or unavailable graph is reported
explicitly; consumers update and retry once before using native tools as a
declared fallback. The SessionStart and PreCompact envelope is bounded at 1,600
characters and mechanically checked not to truncate the tool policy.
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
the PR risk report remains visible; approved broad refactors may use the
non-blocking `none` threshold while deterministic validation remains required.
CRG reduces broad exploratory reads but does not replace exact source
inspection or tests.
