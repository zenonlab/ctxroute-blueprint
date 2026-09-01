---
scope:
  - .githooks/ast-registry.mjs
  - .githooks/sensor-engine.mjs
  - scripts/context-ast.mjs
  - scripts/context-mcp.mjs
  - scripts/ast-check.mjs
  - scripts/ast-update.mjs
  - scripts/context-benchmark.mjs
  - scripts/validate-mcp-installation.mjs
  - .codex/config.toml
  - .mcp.json
  - .github/workflows/validate.yml
  - .project/ast-compatibility.json
  - .project/project-config.json
  - tests/ast-infrastructure.test.mjs
  - tests/mcp-stdio.test.mjs
  - package.json
  - package-lock.json
review: on-change
revised: true
---
# ADR-0016 — AST context MCP boundary

- Status: accepted
- Date: 2026-09-01

The Sensor and context MCP are separate pipelines. Sensor remains the
PostToolUse/pre-commit blocking boundary; the context MCP is read-only and
does not replace Sensor or Progress MCP.

The single executable registry declares every Sensor adapter and the
JavaScript, TypeScript/TSX, Python and Ruby grammars (including `.rb`, `.rake`,
`.ru`, named Ruby files, and same-length Ruby extraction from `.erb`). Installed
grammars are exact in `package.json` and `package-lock.json`; `npm run
ast:check` validates loading and parsing. `npm run ast:update` only reports
candidates. Its explicit `--apply` mode tests an isolated candidate tree and
the complete AST test matrix before installing exact versions and replacing
the versioned compatibility proof. PHP remains explicitly lexical.

The context server exposes `list_symbols`, `summarize_file`,
`find_definition`, `find_references`, and `get_relevant_context`. It performs
no LLM or network calls. A central path guard rejects absolute paths,
traversal, workspace escapes and outbound symlinks; Git ignore rules,
negations, and configured generated directories apply even to direct paths.
Global searches have strict `product` and `blueprint` scopes and reject mixed
requests. Every response uses a structural budget counted by the exact
`gpt-tokenizer@4.0.0` package and never returns complete source by default.
The benchmark reports observed counts, ratio, tokenizer, bytes and duration.
Versioned thresholds prevent repository regressions without presenting the
observed reduction as a universal promise.

Codex loads both stdio servers from project-scoped `.codex/config.toml` and
Claude loads them from project-scoped `.mcp.json`. Client configuration owns
their transport lifecycle. PostToolUse continues to run CTXRoute, Sensor,
problem memory, audit and Archify only; it never starts either MCP server.
