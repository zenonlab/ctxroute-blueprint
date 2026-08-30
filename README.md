# CTXRoute Blueprint

[![Validate](https://github.com/zenonlab/ctxroute-blueprint/actions/workflows/validate.yml/badge.svg)](https://github.com/zenonlab/ctxroute-blueprint/actions/workflows/validate.yml)
[![GitHub Template](https://img.shields.io/badge/GitHub-template-181717?logo=github)](https://github.com/zenonlab/ctxroute-blueprint/generate)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm 10+](https://img.shields.io/badge/npm-10%2B-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![CTXRoute](https://img.shields.io/badge/context-CTXRoute-7c3aed)](https://github.com/zenonlab/ctxroute)
[![Archify v2.16.0](https://img.shields.io/badge/architecture-Archify_v2.16.0-06b6d4)](https://github.com/tt-a1i/archify/releases/tag/v2.16.0)
[![tree-sitter Sensor](https://img.shields.io/badge/security-tree--sitter_Sensor-ef4444)](https://tree-sitter.github.io/tree-sitter/)
[![Codex + Claude](https://img.shields.io/badge/agents-Codex_%2B_Claude-111827)](AGENTS.md)
[![Linux, macOS, Windows](https://img.shields.io/badge/CI-Linux_%7C_macOS_%7C_Windows-2563eb)](.github/workflows/validate.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An architecture-first [GitHub template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository)
for software projects. It does not impose a language, backend, frontend,
database, deployment platform, or test framework.

The generated product remains stack-neutral. The template tooling requires
[Node.js 22+](https://nodejs.org/) and [npm 10+](https://www.npmjs.com/) to run
[CTXRoute](https://github.com/zenonlab/ctxroute), governance hooks, tests, and
[Archify](https://github.com/tt-a1i/archify) and the tree-sitter Sensor.

The blueprint combines five infrastructure layers:

- **Agent governance:** one shared doctrine for Codex and Claude, enforced by
  project-local lifecycle and Git hooks.
- **Context routing:** CTXRoute injects only the project guidance relevant to
  the current action.
- **Architecture:** Archify validates versioned JSON IR and generates an
  interactive artifact outside Git.
- **Static safety:** the tree-sitter Sensor analyzes supported source files and
  emits stable JSON diagnostics.
- **Portable validation:** Node.js 22 CI runs on Linux, macOS, and Windows.

## Create a project

1. Select **Use this template** on GitHub.
2. Clone the generated repository and enter its root directory.
3. Install Git, Node.js 22+, and npm 10+.
4. Bootstrap the repository:

   ```sh
   npm run setup
   ```

   Setup runs `npm ci`, restores the pinned Archify skill, runs Archify Doctor,
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

`.codex/`, `.claude/`, `.githooks/`, `.project/`, `rules/`, [`AGENTS.md`](AGENTS.md),
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

Codex Cloud can run `npm install` before the agent starts, so CTXRoute is
installed and verified automatically. Hook activation still depends on the
workspace trust policy; installation cannot bypass that security boundary.

For prerequisite diagnostics without installing anything, run
`npm run setup:check`.

## Validate

Run the complete repository gate:

```sh
npm run validate
```

For a full local verification after initialization:

```sh
npm run validate
npm run build:docs
npm run sensor -- <paths>
git status --porcelain
```

The final command must produce no output. Generated documentation belongs under
the ignored `dist/` directory and must never be committed.

## Architecture with Archify

The versioned architecture source is
[`docs/architecture/src/blueprint.architecture.json`](docs/architecture/src/blueprint.architecture.json).
It is validated at Archify's `showcase` quality level.

```sh
npm run validate:architecture
npm run build:docs
npm run preview:docs
```

`build:docs` generates `dist/architecture/blueprint.html`; `preview:docs`
builds it and starts the local interactive preview. The generated HTML is not a
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

The Sensor parses JavaScript, JSX, TypeScript, TSX, and Python with tree-sitter.
It reports one stable JSON object containing a verdict and ordered diagnostics.
Standalone comments and strings are ignored, while command literals passed to
recognized shell APIs are inspected.

```sh
npm run sensor -- src/example.ts scripts/check.py
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
`shell: true`, direct secret-to-network output, syntax errors, and excessive AST
complexity.

The agent must not delete starter guides without user confirmation. It creates
verified commits automatically. See the [repository contribution rules](CONTRIBUTING.md)
and [security policy](SECURITY.md) for project-level guidance.

## License

CTXRoute Blueprint is licensed under Apache-2.0. CTXRoute remains available under
its own MIT license; see `THIRD_PARTY_NOTICES.md`.
