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

- Progress is a compact, ordered memory of intent and outcomes, never a prerequisite, taskmaster, or global implementation lock.
- Skip Progress for small, reversible, or single-agent changes. For a substantial chantier, prefer 2–6 coherent milestones; do not turn files, commands, commits, or routine edits into separate steps.
- Preserve milestone order. Mark `claimable: true` only on genuinely independent work packages that can run in parallel; explicit agents may claim those packages once and report once after verification.
- For substantial work with at least two genuinely independent claimable milestones, start the matching `progress-worker` subagents without asking for another `go`. Otherwise stay single-agent and skip automatic claims. A plan records intent and order; it never creates a conversational permission gate or requires repeated approval.
- Only a subagent explicitly started as `progress-worker` may be auto-assigned a claimable `automatic` milestone. `SubagentStop` may settle its owned milestone from a valid `PROGRESS_RESULT` footer, and `SessionEnd` may release remaining session claims. No `PostToolUse` hook changes Progress.
- Report `DONE` or `BLOCKED` with short evidence after the work. If Progress is busy or unavailable, continue safe in-scope work and reconcile the ticket afterward.
- Use `manual` only with reason `visual-review` or `important-decision` for an important undecided product/change/design choice. All other tickets remain `automatic` and never block Stop.
- MCP is the optional rich interface for inspecting or editing the memory. Use the matching `npm run progress:*` command as an equivalent local fallback when MCP is unavailable or urgency favors the CLI.
- Session and post-compaction hooks may inject only a bounded active-goal reminder. Continue from that reminder directly; query MCP or CLI only when the task actually needs details or a Progress mutation.
- Start or restart the agent from the repository root so project-local MCP servers are loaded.

## Development

- Read existing files before writing.
- Read the relevant documents and diagrams before changing code.
- For changes that materially alter a boundary, contract, dependency, or system flow, read the Archify architecture source and relevant ADRs. A routine feature or internal implementation change does not require Archify by itself.
- Reuse existing functions, components, and patterns.
- Define success criteria before coding.
- Make the smallest viable change.
- For a localized edit, send a narrow patch containing only changed fields or diff hunks; never resend or rewrite an entire file, document, ticket, or Progress state when a delta is sufficient.
- Touch only necessary files.
- Avoid speculative abstractions and refactors.
- Verify every modification.
- Review the diff after each write.
- Complete one coherent claimed work package before taking another; ordinary work need not be claimed or mirrored in Progress.

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

- One coherent verified outcome per commit; do not create micro-commits merely to mirror Progress milestones.
- Branches: `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/`, `perf/`.
- Commits: `type(scope): short description`.
- Allowed types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`.
- Request confirmation before deletion.
- Commit verified functional steps automatically without requesting confirmation.
- Never delete automatically.
