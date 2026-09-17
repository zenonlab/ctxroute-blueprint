---
scope:
  - .agents/skills/
  - .claude/settings.json
  - .codex/config.toml
  - .codex/hooks.json
  - .codex/hooks/
  - .mcp.json
  - .project/orchestrator-config.json
  - .project/schemas/orchestrator/mission-view.schema.json
  - docs/architecture/src/blueprint.architecture.json
  - docs/architecture/src/traffic.dataflow.json
  - scripts/orchestrator-*.mjs
  - scripts/session-audit.mjs
  - scripts/worktree-manager.mjs
review: on-change
revised: true
contracts:
  - package.json
  - docs/document-contracts.json
superseded-by: ADR-0087-durable-modular-orchestration.md
---
# ADR-0022 — Universal CTXRoute orchestration

- Status: superseded
- Date: 2026-09-06

## Decision

Keep CTXRoute as the on-demand context engine and use no separate checklist
runtime in the execution path. A project-local orchestrator is the sole authority for global
goal and mission state. Its MCP server and mirror CLI call the same
transactional core. Mutations carry an operation identifier and an expected
revision so retries are idempotent and concurrent writes fail explicitly.

The default mode is `SWARM_ON`. The orchestrator prepares minimal worker
missions and isolated Git worktrees. `SWARM_OFF` is a user-selected execution
mode in which the primary agent works directly: no goal, mission, ticket,
worktree, or MCP call is required. Skills remain equally discoverable in both
modes because execution mode is not part of skill routing.

Every mutating `SWARM_ON` request enters through `orchestrator_run_goal`. A
short-lived, read-only `goal-planner` process returns a schema-validated plan
before the orchestrator persists a goal or allocates a worktree. The local
dispatcher then runs dependency-ready missions through the closed `codex`,
`claude`, `gemini`, or test-only `fixture` adapters. Adaptive selection is
governed by ADR-0029; legacy configurations may still select one global
runtime. Neither mode accepts an executable path.

Workers do not commit or mutate global state. The orchestrator replays declared
validations, commits only in-scope paths with a deterministic local identity,
and cherry-picks under its global lock. `COMPLETED` therefore means the change
is present on the main checkout. A conflict is aborted only for the
orchestrator-owned cherry-pick and retains the worktree and recovery evidence.

Missing skills are a saga, not a rewritten original mission. The original
waits in `WAITING_FOR_SKILL`; a distinct `skill-creator` mission is executed,
then a separate read-only `blueprint-audit` process reviews it. Accepted skills
are integrated, re-digested from the main checkout, registered, and the
original mission resumes. A final read-only `goal-auditor` maps every criterion
to mission and repository evidence, requests bounded repair missions when
needed, and alone authorizes automatic goal completion.

Worker input contains only its mission, repository-relative file scope,
selected skill and version, acceptance criteria, validation commands, and
response format. Full conversation history is never serialized into a
mission. CTXRoute references remain locally queryable through the coordination
MCP and CLI, but lifecycle hooks do not inject the global corpus on every tool
call.

Worker and audit reports are schema-checked and byte-bounded. Session traces
are an opportunistic audit source only. A streaming reader redacts secret-like
keys and values before producing compact findings; raw trace content is never
returned to the interactive caller. Audit corrections and goal adjustments
are submitted as orchestrator transactions. Blueprint review is a separate
mechanical gate and reviews changes made by skills, auditors, and the blueprint
itself.

Lifecycle hooks retain only minimal session/mission initialization, targeted
mission injection, bounded worker restitution, cleanup, security checks, and
passive observability. Stop always fails open, honors `stop_hook_active`, and
never schedules or blocks in order to continue work. The goal runner owns its
loop through a terminal `COMPLETED` or `BLOCKED` state.

Session initialization supplies one bounded file-routing map derived from the
project configuration and active ADR scopes, and PreCompact refreshes the same
map after context compaction. The map is guidance retained
in the agent context, not a second policy store. Before a mutation, the hook
resolves the exact tool targets together with the accumulated Git diff and
names the ADR or architecture prerequisites that must be read then. After the
mutation, hooks audit the resulting cumulative scope; they never issue a
retroactive instruction to perform a prerequisite read.

## Resource boundaries

No arbitrary maximum number of goals, missions, steps, or workers is part of
the domain contract. State, reports, context output, subprocess duration,
parallel worktrees, and physical disk usage are byte-, time-, or
resource-bounded. Worktrees isolate concurrent write sets but are not a
security sandbox.

## Recovery

Global state writes use a same-directory temporary file, fsync, and atomic
rename. Transactions record their operation identifier and payload digest.
Conflicting revisions or reused identifiers with different payloads are
rejected. Worktree creation is recoverable, conflict detection compares the
declared scope with actual changes, and cleanup never deletes a worktree that
contains uncommitted changes unless an explicit rollback transaction requests
it.

## Consequences

The superseded checklist, its automatic mutations, and its Stop handoff are not
part of the active control plane. Codex and Claude declare the same `ctxroute-orchestrator`
and official code-review-graph servers. Simple direct work remains possible
without either MCP server in `SWARM_OFF`; coordinated work has durable,
auditable ownership in `SWARM_ON`.
