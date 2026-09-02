# CTXRoute Blueprint

[![Validate](https://github.com/zenonlab/ctxroute-blueprint/actions/workflows/validate.yml/badge.svg)](https://github.com/zenonlab/ctxroute-blueprint/actions/workflows/validate.yml)
[![GitHub Template](https://img.shields.io/badge/GitHub-template-181717?logo=github)](https://github.com/zenonlab/ctxroute-blueprint/generate)
[![Node.js 22.13+](https://img.shields.io/badge/Node.js-22.13%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm 10+](https://img.shields.io/badge/npm-10%2B-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![uv 0.11.2](https://img.shields.io/badge/uv-0.11.2-DE5FE9)](https://github.com/astral-sh/uv)
[![CTXRoute](https://img.shields.io/badge/context-CTXRoute-7c3aed)](https://github.com/zenonlab/ctxroute)
[![code-review-graph v2.3.8](https://img.shields.io/badge/context-code--review--graph_v2.3.8-10b981)](https://github.com/tirth8205/code-review-graph/releases/tag/v2.3.8)
[![Archify v2.16.0](https://img.shields.io/badge/architecture-Archify_v2.16.0-06b6d4)](https://github.com/tt-a1i/archify/releases/tag/v2.16.0)
[![tree-sitter Sensor](https://img.shields.io/badge/security-tree--sitter_Sensor-ef4444)](https://tree-sitter.github.io/tree-sitter/)
[![Codex + Claude](https://img.shields.io/badge/agents-Codex_%2B_Claude-111827)](AGENTS.md)
[![Linux, macOS, Windows](https://img.shields.io/badge/CI-Linux_%7C_macOS_%7C_Windows-2563eb)](.github/workflows/validate.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An architecture-first GitHub template for building software with Codex or
Claude while keeping decisions, context, diagrams, checks, and review evidence
inside the repository.

The generated product stays stack-neutral: the blueprint does not impose a
language, backend, frontend, database, deployment platform, or test framework.
Its local toolchain provides the guardrails needed to choose those technologies
deliberately and verify the result.

[Use this template](https://github.com/zenonlab/ctxroute-blueprint/generate) ·
[Agent doctrine](AGENTS.md) ·
[Architecture](docs/architecture/README.md) ·
[Quality strategy](docs/02-quality-strategy.md) ·
[Contributing](CONTRIBUTING.md)

## What you get

| Capability | What it provides |
| --- | --- |
| Agent governance | One repository doctrine for Codex and Claude, enforced by project-local lifecycle and Git hooks. |
| Relevant context | CTXRoute injects only the guidance needed for the current action and reinjects bounded context after compaction. |
| Persistent execution | Progress MCP tracks approved goals, evidence, and collaborative or explicitly confirmed autonomous execution. |
| Code intelligence | `npm run setup` installs the official [Code Review Graph](https://github.com/tirth8205/code-review-graph) Python package at [`code-review-graph==2.3.8`](https://github.com/tirth8205/code-review-graph/releases/tag/v2.3.8) for bounded MCP context, impact analysis, and fork-safe PR risk review. |
| Architecture evidence | Archify validates typed JSON IR and generates interactive artifacts without publishing blueprint control-plane diagrams. |
| Static safety | The tree-sitter Sensor reports deterministic diagnostics across AST, embedded, and lexical adapters. |
| Portable validation | Node.js 22 CI runs the same repository gate on Linux, macOS, and Windows. |

## Quick start

Prerequisites: Git, Node.js 22.13+, npm 10+, Python 3.10+, and uv 0.11.2.
Python 3.12 is the reference runtime for official code-review-graph.

1. Select **Use this template** on GitHub, then clone the generated repository.
2. Bootstrap and verify the workspace:

   ```sh
   npm run setup
   ```

3. In Codex, open `/hooks` and approve the six workspace definitions. Claude
   reads the tracked `.claude/settings.json` configuration directly.
4. Ask the agent to read [`AGENTS.md`](AGENTS.md) and
   [`CLAUDE.md`](CLAUDE.md), then initialize the project from your requirements.
5. Review the generated [project brief](docs/00-project-brief.md),
   [technology decisions](docs/01-technology-decisions.md),
   [ADRs](docs/decisions/README.md), [architecture](docs/architecture/README.md),
   and [quality strategy](docs/02-quality-strategy.md).
6. Approve starter-file cleanup only after initialization is complete.
   Verified project commits are then created automatically.

While `.project/project-config.json` has status `template`, governance blocks
product-code writes until the decisions, architecture, and quality strategy are
complete.

### What setup does

`npm run setup` installs pinned dependencies, restores the pinned Archify skill,
runs Archify Doctor, synchronizes the frozen CRG environment, builds the ignored
code graph, verifies CTXRoute and agent configuration, enables repository Git
hooks, and executes the complete validation suite.

Setup changes only workspace state. It may refresh ignored directories such as
`node_modules/`, `.code-review-graph/`, and `.ctxroute/`, but it does not change
global Codex or Claude settings, delete tracked project files, or create commits.
It reports legacy global CTXRoute hooks without editing them.

For prerequisite diagnostics without installation, run:

```sh
npm run setup:check
```

## Agent execution and context

[`AGENTS.md`](AGENTS.md) is the single project doctrine for both supported
agents. [`CLAUDE.md`](CLAUDE.md) imports it directly instead of duplicating
rules. The reusable control plane lives in `.codex/`, `.claude/`, `.githooks/`,
`.project/`, and the documentation tree; product directories are created only
after discovery.

### Progress checklist

Approved plans are stored in [`.project/progress.json`](.project/progress.json).
The generated [short view](docs/progress.md) is informational and must not be
edited directly. Validation is read-only; materialization requires short
validation evidence and explicit `approved: true`.

```sh
npm run progress:read
npm run progress:status
npm run progress:next -- goal-id
npm run progress:update -- update.json
npm run progress:mode -- goal-id autonomous
npm run progress:validate -- plan.json
npm run progress:approve -- plan.json
```

Progress supports multiple goals, atomic idempotent writes, bounded step
evidence, and exactly two execution modes:

- `collaborative` is the default and keeps meaningful decisions with the user.
- `autonomous` is enabled only after an explicit user request and directs the
  agent to complete and verify the whole approved goal before returning.

The CLI and the `ctxroute-progress` MCP server use the same progress core.

### Local MCP servers

The repository exposes two independent stdio servers:

- `ctxroute-progress` runs `npm run progress:mcp` and exposes checklist,
  step-update, next-step, and execution-mode tools.
- `code-review-graph` runs `npm run crg:mcp` and exposes six bounded read and
  context tools from official CRG v2.3.8 against the ignored local graph.

Codex reads [`.codex/config.toml`](.codex/config.toml); Claude reads
[`.mcp.json`](.mcp.json). These project manifests never alter user-global
configuration. A trusted client must approve project MCP servers. Restart the
client if it has cached an older manifest, and use `/mcp` to inspect the loaded
servers.

```sh
npm run mcp:validate
npm run mcp:smoke
npm run crg:smoke
```

CRG embeddings are disabled by default. Local embeddings require an explicit
optional installation and command. Cloud providers require their documented
environment variable plus `CRG_ACCEPT_CLOUD_EMBEDDINGS=1`; never commit a key
or provider configuration.

### CTXRoute lifecycle

[CTXRoute](https://github.com/zenonlab/ctxroute) routes relevant project
guidance to agent actions through one project-local dispatcher. Rules live in
[`.claude/hooks/docs/`](.claude/hooks/docs/) and remain available to Codex and
Claude-compatible tooling.

The lifecycle covers `SessionStart`, `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `PreCompact`, and `Stop`. Healthy CRG startup adds no
context. Targeted documentation is injected before relevant tool calls, and
only the minimum required context is restored after compaction.

Tracked guidance uses `mode: once`: a matching document is injected once per
session and may be delivered again after `PreCompact`, without repeating every
few turns while an agent is only exploring the project.

`PostToolUse` runs write guards, the blocking Sensor, a bounded single-flight
CRG update, problem memory, documentation audit, and Archify preview support.
It does not start MCP servers; the clients own their stdio transports. CRG
failures and its 30-second timeout fail open with a short visible diagnostic.

Keep only the project-local lifecycle definitions after approval. Legacy global
CTXRoute hooks would run in addition to them, duplicating context and process
startup. Local state and recurring problem memory live in ignored `.ctxroute/`;
removing that directory clears local history and it is recreated on demand.

Codex Cloud may run `npm install` before the agent starts, but hook activation
still depends on workspace trust and cannot be bypassed by installation.

## Architecture with Archify

Product diagram sources are versioned under `docs/architecture/src/` and must
pass Archify's `showcase` profile. The agent chooses the view that best matches
the completed step:

| Type | Use it for |
| --- | --- |
| `architecture` | Components and boundaries |
| `workflow` | Procedures, hooks, and CI/CD |
| `sequence` | Calls, requests, and responses |
| `dataflow` | Traffic, pipelines, and lineage |
| `lifecycle` | States, retries, waiting, and terminal transitions |

Blueprint control-plane sources are maintainer-only inputs. Product selectors,
builds, previews, and visual checks cannot publish them.

```sh
npm run validate:architecture
npm run build:docs
npm run archify:visual-check
npm run preview:docs
```

Every command accepts a product source ID or diagram type; `all` selects every
product source, never internal sources.

```sh
npm run archify:validate -- dataflow
npm run build:docs -- all
npm run archify:visual-check -- dataflow
npm run preview:docs -- checkout.sequence
```

Builds create one ignored HTML artifact per source under `dist/architecture/`.
`archify:visual-check` verifies containment at four desktop resolutions and
writes screenshots, a contact sheet, and a JSON receipt. Its automated
`visualReview` remains `pending` until human review. Preview builds one explicit
selection and starts the interactive local viewer. Generated HTML is never a
source file and must not be edited manually.

Archify is pinned to v2.16.0 in [`skills-lock.json`](skills-lock.json) and
[`.project/archify-pin.json`](.project/archify-pin.json). Updates are explicit:
review the release and hash, update the pin, regenerate the lock, run Doctor and
the full verification suite, then confirm a clean Git state. Use
`npm run check:updates` for read-only release awareness.

## Safety and verification

### Local gate

Run the deterministic repository gate during development:

```sh
npm run validate
```

It covers configuration, decisions, architecture and document contracts,
CTXRoute, lint, workspace coherence, the Sensor baseline, and test coverage.
For final verification, including CRG and Progress MCP smoke tests, integration,
dependency audit, and generated documentation, run:

```sh
npm run verify
git status --porcelain
```

The final command must produce no output. Generated documentation belongs in
ignored `dist/` and must never be committed.

### Sensor

The Sensor is independent from CRG and is the only blocking static-safety
boundary. Its catalogue preserves every recognized extension while reporting
four honest capability states: `PASS`, `PARTIAL`, `MISSING`, and `N/A`.

- `PASS` requires a parser loaded and exercised on Node 22.
- `PARTIAL` identifies an extractor or bounded lexical check.
- `MISSING` identifies an expected capability without a verified parser.
- `N/A` means the capability does not apply to that language.

JavaScript/JSX, TypeScript/TSX, Python, Ruby/ERB, and JSON currently have
verified syntax parsing. Other catalogue entries remain explicitly partial or
missing. Recognition is never presented as parsing, and a lexical fallback can
never report complete coverage.

```sh
npm run sensor -- src/example.ts scripts/check.py
npm run sensor -- --sarif src/example.ts
npm run sensor:blueprint
npm run sensor:checklist -- --json
npm run sensor:languages -- list
npm run sensor:languages -- status --json
npm run sensor:languages -- install javascript python
npm run sensor:languages -- install --preset web
npm run sensor:languages -- remove python
npm run sensor:languages -- sync
```

Presets are `web`, `backend`, `systems`, `mobile`, `templates`, `data-config`,
and `all`. Commands accept catalogue identifiers only. Installation pins exact
versions in both npm manifests, validates the parser, and rolls back manifest
changes on failure. A preset containing an unverified parser fails visibly;
setup may synchronize packs, but hooks and scans never install dependencies.

Project configuration declares requirements explicitly:

```json
{
  "quality": {
    "sensor": {
      "languages": ["javascript", "typescript", "python"],
      "antiSlopEffect": "auto"
    }
  }
}
```

| Verdict | Meaning | Exit code |
| --- | --- | ---: |
| `SAFE` | No diagnostic | `0` |
| `WARN` | Configured complexity limit exceeded | `1` |
| `UNSAFE` | Dangerous executable construct detected | `2` |
| `ERROR` | Invalid input, unsupported language, read, or syntax error | `2` |

Sensor JSON schema 2 adds per-file language, parser and capability coverage
while retaining `verdict` and `diagnostics`. Rules and thresholds live in
[`.project/sensor-rules.json`](.project/sensor-rules.json). Checks include
dynamic evaluation, dangerous shell execution, SQL injection, secret-to-network
flow, dynamic function construction, `shell: true`, XSS, SSRF, path traversal,
weak crypto, UI layering, syntax errors, and excessive AST complexity. `LIMIT`
bounds SQL result rows; optional
`requireRateLimit` is a separate request-rate heuristic and never proves runtime
enforcement. SARIF 2.1.0 is available for code-scanning integrations.

The 15 official JavaScript/TypeScript anti-slop rules are vendored from an
immutable upstream commit and run once per batch as blocking `anti-slop/*`
diagnostics. The optional Effect group is separate and activates in `auto` mode
only when `effect` is a direct dependency. Multilanguage quality heuristics are
blueprint rules under `sensor/quality/*`; they are not represented as official
anti-slop rules. Local analysis remains bounded and does not prove types,
package behavior, whole-program flows, or runtime enforcement.

### CI and repository protection

The tracked workflow validates Node.js 22 on Linux, macOS, and Windows, including
the real Progress MCP transport. Linux and macOS additionally smoke-test the
official CRG transport. Pull requests receive a fork-safe `CRG risk gate`, while
unexpected Sensor diagnostics are uploaded as SARIF when permissions allow.

GitHub templates copy files and branches, not the source repository's security
settings. Configure branch protection or an organization ruleset for every
derived project. Require the relevant CI jobs and enable Dependabot alerts,
secret scanning with push protection, code scanning, and a private
vulnerability-reporting channel.

See [CI/CD](docs/ci.md), [contribution rules](CONTRIBUTING.md), and the
[security policy](SECURITY.md) for the complete operational contract.

## Repository contracts

`.project/project-config.json` is the source of truth for project status,
source directories, code extensions, commands, document contracts, and mutation
policy. Invalid or incomplete configuration blocks product writes.

Documentation follows the schema-first registry in
[`docs/document-contracts.json`](docs/document-contracts.json). Structured
sources are authoritative for typed facts; Markdown adds context and is checked
by `npm run validate:docs -- --all`.

Starter guides are removed only with user confirmation after initialization.
Verified changes are committed automatically according to
[`AGENTS.md`](AGENTS.md).

## License

CTXRoute Blueprint is licensed under Apache-2.0. CTXRoute remains available
under its own MIT license; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
