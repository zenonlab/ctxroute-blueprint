# Project documentation

These documents describe the clean-room Tobirink product and its collaborative
delivery contract. The repository remains in template status until the product
configuration and executable commands are approved for initialization.

## Foundation workflow

1. Agree one bounded architectural or implementation step.
2. Record durable decisions and product-only architecture evidence.
3. Obtain explicit approval for the exact bounded step.
4. Implement the smallest change, verify it, and report evidence.
5. In collaborative mode, ask again before the next step. In confirmed
   autonomous mode, continue through materialized steps. Always ask before
   expanded scope, push, deployment, provider mutation, publication, or
   deletion—not between approved edits and checks.

Initialization remains a separate approval because it changes the project
lifecycle. The versioned Archify JSON IR is the architecture source of truth.

## Structure

- `00-project-brief.md`: goals, scope, and constraints.
- `01-technology-decisions.md`: technical choices and criteria.
- `02-quality-strategy.md`: test and quality strategy.
- `architecture/`: product-only versioned Archify JSON IR and guidance.
- `decisions/`: durable decisions as ADRs.
- `systems/`: subsystem contracts and responsibilities.
- `workflows/`: important procedures and interactions.
- `ui-design-contract.md`: framework-neutral UI rules implemented through the
  React adapter.

`architecture/src/tobirink.architecture.json` is the product architecture
source; interactive HTML is generated under ignored `dist/`.
The schema-first document registry is [`document-contracts.json`](document-contracts.json);
it declares authoritative structured sources and the Markdown context that
complements them. `npm run validate:docs -- --all` validates the registry.
