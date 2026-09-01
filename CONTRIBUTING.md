# Contributing

Read `AGENTS.md` and the relevant documentation before making changes.

- Structural changes update the Archify JSON IR.
- Durable decisions become ADRs.
- Archify JSON IR is versioned; generated HTML stays under ignored `dist/`.
- Commands declared in `.project/project-config.json` must exist.
- Source directories, code extensions, and contracts come only from that configuration.
- Git, Node.js 22.13+, npm 10+, Python 3.10+, and uv 0.11.2 are required for template tooling, independently of the product stack.
- Never delete automatically; request confirmation before deletion.
- Commit verified functional steps automatically.

Before contributing, run the idempotent project setup:

```sh
npm run setup
```

Before pushing a complete change, run `npm run verify`. This includes lint,
coverage, the whole-blueprint Sensor gate, CRG smoke and MCP integration,
the dependency audit, and the Archify documentation build.

GitHub Actions repeats setup and contract checks on Linux, macOS, and Windows.
GitHub Codespaces runs the same setup from `.devcontainer`. The blueprint does
not deploy a product; CI artifacts are limited to Archify documentation and
visual evidence, CRG smoke, Sensor reports, and a sanitized summary.

Pre-commit validates the Git index, architecture, links, placeholders,
and targeted mutation testing when enabled. Pre-push runs the complete commands
declared by the project.
