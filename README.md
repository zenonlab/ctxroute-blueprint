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

An architecture-first [GitHub template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository)
for software projects. It does not impose a language, backend, frontend,
database, deployment platform, or test framework.

The generated product remains stack-neutral. The template tooling requires
[Node.js 22.13+](https://nodejs.org/) and [npm 10+](https://www.npmjs.com/) to run
[CTXRoute](https://github.com/zenonlab/ctxroute), governance hooks, tests, and
[Archify](https://github.com/tt-a1i/archify) and the tree-sitter Sensor. Official
[code-review-graph](https://github.com/tirth8205/code-review-graph) additionally
requires Python 3.10+ and uv 0.11.2; Python 3.12 is the reference runtime.

The blueprint combines six infrastructure layers:

- **Agent governance:** one shared doctrine for Codex and Claude, enforced by
  project-local lifecycle and Git hooks.
- **Context routing:** CTXRoute injects only the project guidance relevant to
  the current action.
- **Code graph:** official code-review-graph v2.3.8 supplies MCP context,
  incremental impact analysis, and fork-safe PR risk review.
- **Architecture:** Archify validates versioned JSON IR and generates an
  interactive artifact outside Git.
- **Static safety:** the [tree-sitter Sensor](https://tree-sitter.github.io/tree-sitter/) analyzes supported source files and
  emits stable JSON diagnostics.
- **Portable validation:** Node.js 22 CI runs on Linux, macOS, and Windows.

## Create a project

1. Select **Use this template** on GitHub.
2. Clone the generated repository and enter its root directory.
3. Install Git, Node.js 22.13+, npm 10+, Python 3.10+, and uv 0.11.2.
4. Bootstrap the repository:

   ```sh
   npm run setup
   ```

   Setup runs `npm ci`, restores the pinned Archify skill, runs Archify Doctor,
   synchronizes the frozen CRG environment, builds the ignored real graph,
   verifies CTXRoute and the agent configurations, enables the repository Git
   hooks, and executes the complete validation suite. It also warns when legacy
   global CTXRoute hooks would run alongside the project-local dispatchers.
5. In Codex, open `/hooks` and approve the six workspace definitions. This is
   the only local activation step; the repository never changes Codex trust
   settings stored outside the workspace. Claude reads the tracked
   `.claude/settings.json` configuration.
6. Ask your [Codex](https://openai.com/codex/) or [Claude](https://www.anthropic.com/claude)
   agent to read [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md), then
   initialize the project from your requirements. While the project status is
   `template`, governance blocks product-code writes until the decisions,
   architecture, and quality strategy are complete.
7. Review the [project brief](docs/00-project-brief.md), [technology decisions](docs/01-technology-decisions.md),
   [architecture decision records](docs/decisions/README.md), [Archify architecture](docs/architecture/README.md),
   and [quality strategy](docs/02-quality-strategy.md).
8. Approve any starter-file cleanup only when the starter is fully initialized;
   verified project commits are created automatically.

`npm run setup` installs the pinned dependencies and Archify skill, enables
the repository Git hooks, validates CTXRoute, and runs the complete test suite.
It refreshes the ignored `node_modules/` directory but does not change global
Codex settings, delete tracked project files, or create commits.

`.codex/`, `.claude/`, `.githooks/`, `.project/`, [`AGENTS.md`](AGENTS.md),
[`CLAUDE.md`](CLAUDE.md), and the documentation structure are reusable
infrastructure. Product source directories and commands are created only after
project discovery.

[`AGENTS.md`](AGENTS.md) is the single source of project doctrine for both
Codex and Claude. [`CLAUDE.md`](CLAUDE.md) imports it directly instead of
duplicating the rules.

`.project/project-config.json` is the source of
truth for source directories, code extensions, contracts, commands, and
mutation-testing policy. Invalid or incomplete configuration blocks product
writes.

## Progress checklist

Approved agent plans are stored in [`.project/progress.json`](.project/progress.json).
The generated [short view](docs/progress.md) is informational and must not be
edited directly. Validation never writes; materialization requires a plan with
short validation evidence and explicit `approved: true`:

```sh
npm run progress:read
npm run progress:status
npm run progress:next -- goal-id
npm run progress:update -- update.json
npm run progress:mode -- goal-id autonomous
npm run progress:validate -- plan.json
npm run progress:approve -- plan.json
```

The same bounded engine is exposed through the stdio MCP server with
`npm run progress:mcp`. It supports multiple goals, atomic idempotent writes,
step evidence, and exactly two modes: `collaborative` (default) and
`autonomous`. Autonomous mode is enabled only after an explicit user request
and confirmation; it directs the agent to complete and verify the whole goal.

## Local MCP servers

The repository exposes two independent stdio servers:

- `ctxroute-progress` runs `npm run progress:mcp` and exposes checklist,
  step-update, next-step, and mode tools.
- `code-review-graph` runs `npm run crg:mcp` and exposes six bounded read/context
  tools from official CRG v2.3.8 against `.code-review-graph/graph.db`.

Codex reads the tracked project configuration in [`.codex/config.toml`](.codex/config.toml),
and Claude reads the tracked [`.mcp.json`](.mcp.json). These files never alter
user-global configuration. A trusted client must approve project MCP servers;
open a new local session or restart the client if it has already cached the
project manifest. Use `/mcp` in the client to inspect the loaded servers and
`npm run mcp:validate`, `npm run mcp:smoke`, or `npm run crg:smoke` for
mechanical verification.

CRG embeddings are off by default. Local embeddings require an explicit
optional installation and command. Cloud providers require their documented
environment variable plus `CRG_ACCEPT_CLOUD_EMBEDDINGS=1`; never commit a key
or provider configuration.

## CTXRoute

[CTXRoute](https://github.com/zenonlab/ctxroute) injects only relevant project
context into agent actions. This repository pins a reviewed upstream commit and
uses project-local wrappers so hook paths work on Windows, macOS, and Linux.
Rule documents live in CTXRoute's canonical
[`.claude/hooks/docs/`](.claude/hooks/docs/) directory and remain available to
both Codex and Claude-compatible tooling.

CTXRoute never modifies global agent settings during installation. The tracked
`.codex/` and `.claude/` configurations remain local to this project. Each
agent receives the same doctrine from `AGENTS.md`; Claude loads it through the
native `@AGENTS.md` import in `CLAUDE.md`.

Keep only the project-local lifecycle definitions once they are approved.
Legacy CTXRoute commands in the global Codex `config.toml` run in addition to
workspace hooks, producing duplicate progress messages and extra process
startup latency. The installer reports this condition but never edits the
global configuration. Lifecycle handlers omit custom status messages, and
`PostToolUse` runs only for tools that can change repository state.
PostToolUse runs CTXRoute guards, the blocking Sensor, a bounded single-flight
CRG update, problem memory, audit, and Archify preview. It does not start either
MCP server; Codex and Claude own the stdio transports. CRG failures and its
30-second timeout fail open with a visible bounded diagnostic.

The project-local lifecycle covers `SessionStart`, `PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `PreCompact`, and `Stop`. CTXRoute state and recurring
problem memory live in the ignored `.ctxroute/` directory; deleting it removes
local history but it is recreated automatically on the next run.

Codex Cloud can run `npm install` before the agent starts, so CTXRoute is
installed and verified automatically. Hook activation still depends on the
workspace trust policy; installation cannot bypass that security boundary.

For prerequisite diagnostics without installing anything, run
`npm run setup:check`.

## Validate

Run the deterministic repository gate:

```sh
npm run validate
```

It includes lint, architecture and document contracts, workspace/governance
coherence, the whole-blueprint Sensor baseline, and test coverage thresholds.
`npm run crg:smoke` separately proves the pinned runtime, fixture build,
incremental update, MCP startup, tool list, and a read call. For the full
verification, including integration,
dependency audit, and generated documentation:

```sh
npm run verify
npm run sensor:blueprint
git status --porcelain
```

The final command must produce no output. Generated documentation belongs under
the ignored `dist/` directory and must never be committed.

## GitHub repository protections

GitHub templates copy repository files and branches, not the complete security
posture of the source repository. After creating a project, configure branch
protection or an organization ruleset, require the CI jobs relevant to the
derived project, and enable Dependabot alerts, secret scanning with push
protection, code scanning, and a working private vulnerability-reporting
channel. The tracked workflow uploads unexpected Sensor diagnostics as SARIF,
but repository security features still require owner or organization policy.

## Architecture with Archify

Product diagrams are versioned under `docs/architecture/src/` and validated at
Archify's `showcase` quality level. Blueprint control-plane diagrams are
maintainer-only inputs and are never included in product builds or previews.

```sh
npm run validate:architecture
npm run build:docs
npm run archify:visual-check
npm run preview:docs
```

`build:docs` generates one HTML artifact per source under
`dist/architecture/`. The agent chooses the Archify type that matches the
step: `architecture` for components and boundaries, `workflow` for procedures
and hooks, `sequence` for call traces, `dataflow` for traffic and lineage, and
`lifecycle` for state transitions. Select a source, or use `all`:

```sh
npm run archify:validate -- dataflow
npm run build:docs -- all
npm run archify:visual-check -- dataflow
npm run preview:docs -- traffic.dataflow
```

`archify:visual-check` checks containment at four desktop resolutions and
writes screenshots, a contact sheet, and a JSON receipt beside each artifact. Its
automated `visualReview` remains `pending` until human review. `preview:docs`
accepts one source or type selector, builds it, and starts its local interactive
preview; when several product diagrams exist, selection is explicit. The generated HTML is not a
source file and must not be edited manually.

Archify is pinned to version `v2.16.0` in
[`skills-lock.json`](skills-lock.json) and
[`.project/archify-pin.json`](.project/archify-pin.json). Updates are always
explicit: review the upstream release, tag, commit, and hash; update the pin;
regenerate the lock through installation; run Archify Doctor, validation,
tests, and the documentation build; then confirm a clean Git state before
committing.

Use `npm run check:updates` to check release awareness; it never performs a
silent update.

## Sensor

The Sensor owns one executable language registry with three explicit coverage
levels. It is independent from CRG and remains the only blocking static safety
boundary:

- **AST:** JavaScript, TypeScript, JSX/TSX, Python, and Ruby.
- **Embedded AST:** Ruby blocks extracted from ERB without changing offsets.
- **Dedicated/lexical:** SQL, HTML, CSS, Vue, Svelte, Rust, Go, Java, Kotlin,
  C/C++, C#, PHP, Swift,
  Dart, Shell, Elixir, Erlang, Haskell, Lua, R, Scala, Solidity, and common
  configuration formats including TOML, YAML, JSON, XML, Terraform, HCL, and
  Protocol Buffers.

AST adapters are syntax-aware. Dedicated and lexical adapters provide bounded
coverage only; they do not claim type, package, dependency, or runtime
analysis. Ruby is a required, exact Tree-sitter dependency; PHP remains
explicitly lexical and is never advertised as AST. A Ruby lexical fallback is
used only when its grammar genuinely cannot load, and every diagnostic records
the actual rule mode, grammar, fallback and reason. The Sensor reports one stable JSON object containing a verdict,
coverage limits, and ordered diagnostics. SARIF 2.1.0 is available for
code-scanning integrations:

```sh
npm run sensor -- src/example.ts scripts/check.py
npm run sensor -- --sarif src/example.ts
node .githooks/sensor --checklist --json
```

Verdicts and exit codes are:

| Verdict | Meaning | Exit code |
| --- | --- | ---: |
| `SAFE` | No diagnostic | `0` |
| `WARN` | Configured complexity limit exceeded | `1` |
| `UNSAFE` | Dangerous executable construct detected | `2` |
| `ERROR` | Invalid input, unsupported language, read, or syntax error | `2` |

Rules and thresholds live in
[`.project/sensor-rules.json`](.project/sensor-rules.json). The Sensor covers
dynamic evaluation, dynamic function construction, dangerous shell commands,
`shell: true`, SQL injection, direct secret-to-network output, XSS, SSRF, path
traversal, weak crypto, UI layering, syntax errors, and excessive AST
complexity. `LIMIT` bounds SQL result rows; optional `requireRateLimit` is a
separate request-rate heuristic and never proves runtime enforcement.

Documentation follows the schema-first registry in
[`docs/document-contracts.json`](docs/document-contracts.json). Structured
sources are authoritative for typed facts; Markdown provides complementary
context and is checked by `npm run validate:docs -- --all`.

The agent must not delete starter guides without user confirmation. It creates
verified commits automatically. See the [repository contribution rules](CONTRIBUTING.md)
and [security policy](SECURITY.md) for project-level guidance.

## License

CTXRoute Blueprint is licensed under Apache-2.0. CTXRoute remains available under
its own MIT license; see `THIRD_PARTY_NOTICES.md`.
