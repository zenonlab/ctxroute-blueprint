# Contributing

Read `AGENTS.md`, the product architecture, and applicable ADRs first.

## Change protocol

1. Propose one bounded step with files, commands, risks, rollback, and
   acceptance criteria.
2. Wait for explicit approval for that exact mutation.
3. Update architecture evidence before adding a module, dependency, contract,
   or provider integration.
4. Make the smallest approved change and review its diff.
5. Run proportionate verification and report evidence.
6. Ask separately before commit, push, deploy, publish, or deletion.

Approval never carries to a later step. Preserve unrelated user changes.

## Architecture rules

- Domain and application packages cannot import WXT, React, Dexie, Wrangler,
  Cloudflare SDKs, browser globals, or provider-specific clients.
- External capabilities cross project-owned ports and adapters.
- Provider mutations cross the `inspect` → `plan` → explicitly approved
  `apply` gate.
- Durable decisions become ADRs.
- Product-only Archify JSON IR is versioned; generated HTML stays under ignored
  `dist/`.

## Verification

Until product commands are added, use `npm run validate` during a change and
`npm run verify` before proposing delivery. The product quality matrix in
`docs/02-quality-strategy.md` becomes mandatory as each corresponding command
is introduced.
