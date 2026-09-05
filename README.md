# Tobirink

Tobirink is a clean-room, local-first browser extension for managing a manga
and anime library, progress, agenda, reminders, and browser-assisted discovery.

FavLib is used only to recover product intent. None of its source code,
structure, migrations, or packages are retained.

## Architecture baseline

The product is built around inward dependencies:

1. Domain rules know only library, progress, and agenda concepts.
2. Application use cases coordinate domain rules through owned ports.
3. Browser, storage, UI, content-source, telemetry, and cloud adapters implement
   those ports.
4. WXT, React, Dexie, and Cloudflare stay at the outer edge and are replaceable.

The selected extension stack is strict TypeScript, WXT 0.21.x pinned exactly,
React 19, CSS Modules, IndexedDB through Dexie, Zod 4, Vitest, and Playwright.
An optional Hono Worker and D1 database may serve anonymous public data. Rails,
accounts, private cloud synchronization, queues, and microservices are outside
the v1 baseline.

See the [project brief](docs/00-project-brief.md), [technology decisions](docs/01-technology-decisions.md), [architecture](docs/architecture/README.md), and [quality strategy](docs/02-quality-strategy.md).

## Collaboration contract

This project is developed one bounded decision at a time.

- Read-only research and validation may proceed.
- Every mutation requires explicit approval for the exact step.
- Approval never carries to a later step.
- Installs, provider mutations, deployments, commits, pushes, and deletions
  require their own approval.
- No file is deleted automatically.

[AGENTS.md](AGENTS.md) is authoritative and [CLAUDE.md](CLAUDE.md) imports it
directly.

## Current status

The product foundation is being documented before initialization. No product
implementation or product dependency has been added yet. The inherited
blueprint control plane remains available for validation but never appears in
product diagrams or runtime code.

## Repository commands

The current commands validate the repository foundation:

```sh
npm run setup:check
npm run validate
npm run verify
npm run archify:validate -- tobirink
```

Product build, test, packaging, infrastructure, and release commands will be
added only in separately approved implementation steps and then recorded in
.project/project-config.json.

## Documentation map

- [Project brief](docs/00-project-brief.md): scope and constraints.
- [Technology decisions](docs/01-technology-decisions.md): selected stack and research.
- [Quality strategy](docs/02-quality-strategy.md): verification contract.
- [Architecture](docs/architecture/README.md): product-only Archify source.
- [Decisions](docs/decisions/README.md): durable architectural decisions.
- [Systems](docs/systems/README.md): subsystem ownership and boundaries.
- [Workflows](docs/workflows/README.md): product and operational flows.
- [CI/CD](docs/ci.md): delivery policy.
- [Security](SECURITY.md): security policy and trust boundaries.

## License

The repository remains licensed under Apache-2.0. Third-party tooling and future
product dependencies retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
