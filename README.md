# CTXRoute Blueprint

[![Validate](https://github.com/zenonlab/ctxroute-blueprint/actions/workflows/validate.yml/badge.svg)](https://github.com/zenonlab/ctxroute-blueprint/actions/workflows/validate.yml)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm 10+](https://img.shields.io/badge/npm-10%2B-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/)
[![Mermaid](https://img.shields.io/badge/diagrams-Mermaid-ff3670?logo=mermaid&logoColor=white)](https://mermaid.js.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

An architecture-first [GitHub template](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-template-repository)
for software projects. It does not impose a language, backend, frontend,
database, deployment platform, or test framework.

The generated product remains stack-neutral. The template tooling requires
[Node.js 22+](https://nodejs.org/) and [npm 10+](https://www.npmjs.com/) to run
[CTXRoute](https://github.com/zenonlab/ctxroute), governance hooks, tests, and
[Mermaid](https://mermaid.js.org/).

## Create a project

1. Select **Use this template** on GitHub.
2. Clone the generated repository and enter its root directory.
3. Install Git, Node.js 22+, and npm 10+.
4. Install the pinned dependencies:

   ```sh
   npm install
   ```

   The `postinstall` check verifies CTXRoute, its lifecycle entry points, and
   the Codex and Claude project configurations. It also warns when legacy
   global CTXRoute hooks would run alongside the project-local dispatchers.
5. In Codex, open `/hooks` and approve the six workspace definitions. This is
   the only local activation step; the repository never changes Codex trust
   settings stored outside the workspace. Claude reads the tracked
   `.claude/settings.json` configuration.
6. Run `npm run setup` when you also want to install the Mermaid browser,
   enable the repository Git hooks, and execute the complete validation suite.
7. Ask your [Codex](https://openai.com/codex/) or [Claude](https://www.anthropic.com/claude)
   agent to read [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md), then
   initialize the project from your requirements.
8. Review the [project brief](docs/00-project-brief.md), [technology decisions](docs/01-technology-decisions.md),
   [architecture decision records](docs/decisions/README.md), [C4 diagrams](docs/architecture/README.md),
   and [quality strategy](docs/02-quality-strategy.md).
9. Approve any starter-file cleanup only when the starter is fully initialized;
   verified project commits are created automatically.

`npm run setup` installs the pinned dependencies and Mermaid browser, enables
the repository Git hooks, validates CTXRoute, and runs the complete test suite.
It refreshes the ignored `node_modules/` directory but does not change global
Codex settings, delete tracked project files, or create commits.

`.codex/`, `.claude/`, `.githooks/`, `.project/`, `rules/`, [`AGENTS.md`](AGENTS.md),
[`CLAUDE.md`](CLAUDE.md), and the documentation structure are reusable
infrastructure. Product source directories and commands are created only after
project discovery.

[`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) provide the project rules
for both Codex and Claude agents. They are intentionally kept aligned; the
repository doctrine designates `AGENTS.md` as the canonical source.

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

```sh
npm run validate
```

The agent must not delete starter guides without user confirmation. It creates
verified commits automatically. See the [repository contribution rules](CONTRIBUTING.md)
and [security policy](SECURITY.md) for project-level guidance.

## License

CTXRoute Blueprint is licensed under Apache-2.0. CTXRoute remains available under
its own MIT license; see `THIRD_PARTY_NOTICES.md`.
