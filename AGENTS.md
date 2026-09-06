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

## Milestones and delegation

- Skip milestone bookkeeping for small, reversible, or single-agent changes. For substantial work, prefer 2–6 coherent milestones; do not turn files, commands, commits, or routine edits into separate steps.
- Preserve milestone order. Delegate only genuinely independent work packages with non-overlapping ownership, and require one bounded result with verification evidence from each worker.
- A plan records intent and order; it never creates a conversational permission gate or requires repeated approval.
- Report `DONE` or `BLOCKED` with short evidence after the work. An unavailable coordination interface does not block safe in-scope work.
- Reserve manual pauses for visual review or an important undecided product, change, or design choice. Routine verification never requires a conversational checkpoint.
- Session and post-compaction hooks may inject only bounded current-goal or mission context. Continue from that context directly and query the orchestrator only when the task needs authoritative state or mutation.
- Start or restart the agent from the repository root so project-local MCP servers are loaded.

## Development

- Read existing files before writing.
- Read the relevant documents and diagrams before changing code.
- For changes that materially alter a boundary, contract, dependency, or system flow, read the Archify architecture source and relevant ADRs. A routine feature or internal implementation change does not require Archify by itself.
- Reuse existing functions, components, and patterns.
- Define success criteria before coding.
- Make the smallest viable change.
- For a localized edit, send a narrow patch containing only changed fields or diff hunks; never resend or rewrite an entire file, document, ticket, or orchestrator state when a delta is sufficient.
- Touch only necessary files.
- Avoid speculative abstractions and refactors.
- Verify each coherent change in proportion to its risk; use targeted checks while iterating and the release gate only before push or handoff.
- Review the accumulated diff at coherent boundaries, not after every small write.
- Complete one coherent delegated work package before taking another; ordinary work need not be mirrored in orchestrator state.

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
- Before changing an architectural boundary, public contract, dependency, or cross-component flow, update the relevant Archify architecture source. Do not update a diagram solely because a requested feature adds ordinary implementation code.
- Store diagrams as versioned text.
- Use typed Archify JSON IR for executable, readable architecture diagrams.
- Record important decisions in `docs/decisions/`.

## Git

- One coherent verified outcome per commit; do not create micro-commits merely to mirror milestones.
- Branches: `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/`, `perf/`.
- Commits: `type(scope): short description`.
- Allowed types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
- Request confirmation before deletion.
- Commit verified functional steps automatically without requesting confirmation.
- Never delete automatically.
