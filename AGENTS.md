# Agent Instructions

## Mandatory initialization

While `.project/project-config.json` has `"status": "template"`, before writing product code, the agent must:

1. Read every starter document and the complete user request.
2. Identify goals, constraints, and genuinely missing information.
3. Define language, runtime, frontend, backend, storage, tests, deployment, observability, security, and performance constraints in `docs/00-project-brief.md`.
4. At the end of each architecture-relevant step, produce or update the product-only Archify JSON IR that best matches the result (`architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle`) and showcase-validate it. Never expose blueprint control-plane components in a product diagram; `all` selects only product sources.
5. Choose the test strategy in `docs/02-quality-strategy.md`.
6. Add required ADRs under `docs/decisions/`.
7. Remove guide comments and placeholders, record only real decisions and commands, then change `.project/project-config.json` to `initialized`.
8. Validate the complete structure, request confirmation before any deletion, and commit verified work automatically.

If the request already provides this information, use it directly and report only important missing decisions.

Once the project is `initialized`, follow Development, Audit, Documentation, and Git without restarting initialization.

## Communication

- Lead with the action or answer.
- Be concise.
- Put one piece of information per line.
- Avoid digressions.
- Give one next action.
- Briefly state the current status.

## Progress

- Before significant mutating work, read the checklist with `progress_status`.
- Create and validate a bounded plan with `progress_validate_plan` before changing files.
- Materialize a plan with `progress_approve_plan` only after explicit user approval.
- Update each active step with `progress_update_step`; `DONE` requires short validation evidence.
- Use the matching `npm run progress:*` command only when the project MCP is unavailable.
- Start or restart the agent from the repository root so project-local MCP servers are loaded.

## Development

- Read existing files before writing.
- Read the relevant documents and diagrams before changing code.
- For structural changes, read the Archify architecture source and relevant ADRs.
- Reuse existing functions, components, and patterns.
- Define success criteria before coding.
- Make the smallest viable change.
- Touch only necessary files.
- Avoid speculative abstractions and refactors.
- Verify every modification.
- Review the diff after each write.
- Complete one step before starting the next.

## Audit

- Audit generated code and its diff.
- Check placement, architecture, structure, and reuse.
- Check for duplication, regressions, deletions, and side effects.
- Audit `AGENTS.md`, `CLAUDE.md`, `.codex/hooks.json`, and modified hooks.
- Verify scope, consistency, format, security, and actual behavior.
- Report issues before continuing.

## Documentation

- Update documentation when architecture, contracts, flows, state, or dependencies change.
- After a code change, explicitly determine whether a document or diagram must change.
- Before adding a module, contract, or dependency, update the Archify architecture source.
- Store diagrams as versioned text.
- Use typed Archify JSON IR for executable, readable architecture diagrams.
- Record important decisions in `docs/decisions/`.

## Git

- One verified functional step per commit.
- Branches: `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/`, `perf/`.
- Commits: `type(scope): short description`.
- Allowed types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
- Request confirmation before deletion.
- Commit verified functional steps automatically without requesting confirmation.
- Never delete automatically.
