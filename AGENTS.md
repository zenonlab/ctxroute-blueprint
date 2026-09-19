# Agent Instructions

## Autonomous development authorization

- Default to autonomous execution for ordinary repository work: inspect, implement, test, document, update Progress, commit, and push the validated result without asking for another `go` between steps.
- Before the first mutation of a new objective, state the objective, affected files or resources, validation, risks, rollback, and acceptance criteria in the working update.
- Keep the implementation focused on the requested objective. If the required design, target, or scope changes materially, stop and explain the decision before proceeding.
- The production workflow may deploy automatically from `main` after its repository checks and scoped Cloudflare plan pass. Do not add interactive approval gates that make normal development progress impossible.
- Keep secrets out of source, logs, artifacts, commits, and command output. Use the existing CI secret store and project-owned provider adapters.
- Preserve safety boundaries for destructive or high-impact operations: deletion, irreversible data migrations, secret rotation, billing changes, permission changes, and direct production mutations outside the declared CI workflow require explicit confirmation immediately before the operation.
- Never delete user work automatically. Preserve unrelated changes and use reversible edits whenever possible.
- Audit the diff, tests, deployment scope, and documentation before reporting completion.

## Mandatory initialization

While `.project/project-config.json` has `"status": "template"`, before writing product code, the agent must:

1. Read every starter document and the complete user request.
2. Identify goals, constraints, and genuinely missing information.
3. Define language, runtime, frontend, backend, storage, tests, deployment, observability, security, and performance constraints in `docs/00-project-brief.md`.
4. At the end of each architecture-relevant step, produce or update the product-only Archify JSON IR that best matches the result (`architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle`) and showcase-validate it. Never expose blueprint control-plane components in a product diagram; `all` selects only product sources.
5. Choose the test strategy in `docs/02-quality-strategy.md`.
6. Add required ADRs under `docs/decisions/`.
7. Remove guide comments and placeholders, record only real decisions and commands, then change `.project/project-config.json` to `initialized`.
8. Validate the complete structure and request explicit confirmation before initialization, cleanup, or commit.

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
- Complete and report one approved step before requesting approval for the next step or any unlisted scope. In confirmed autonomous mode, continue directly to the next materialized step.

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
- A verified commit is authorized with its approved step when the proposal included it; otherwise request explicit confirmation after showing the diff and proposed message.
- Never delete automatically.
