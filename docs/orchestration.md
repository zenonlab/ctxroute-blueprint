# CTXRoute orchestration

CTXRoute remains the local context engine. Context is requested explicitly
through `ctxroute_context_query` or the mirror CLI instead of being injected on
every tool call. The query returns bounded references and never serializes the
global conversation into a worker mission.

## Modes

`SWARM_ON` is the configured default when no state exists. Every mutating
request is synthesized into a closed `GoalRunRequest` and enters through
`orchestrator_run_goal`. The orchestrator owns planning, worker missions,
worktree allocation, process launch, report intake, Git integration, audit,
repair, and completion. Raw prompts and conversation history are never stored.

`SWARM_OFF` means the primary agent executes directly. It does not require a
goal, ticket, worktree, MCP call, or orchestration transaction. It does not
change skill discovery, tool access, or validation requirements.

The effective mode is resolved in this order: a valid
`CTXROUTE_SWARM_MODE`, the persisted mode, then the configured default. Every
decision reports `mode_source` as `environment`, `state`, or `default`.
Persistent mode changes use a `mode.set` orchestrator transaction.

Mission requests declare `execution: auto | direct | coordinated`. `direct`
never allocates a worktree. In the default `SWARM_ON` mode, both `auto` and
`coordinated` create a durable mission, isolate its worktree, and route the
selected skill; only an explicit `direct` request or `SWARM_OFF` bypasses the
worker pipeline. The decision still records its structured reason.

## Local interfaces

Codex and Claude expose `ctxroute-orchestrator` over stdio. The CLI calls the
same service and is the emergency path when MCP is unavailable:

```sh
npm run orchestrator:read
npm run orchestrator:doctor
npm run orchestrator:cli -- mutate transaction.json
npm run orchestrator:run-goal -- goal.json
npm run orchestrator:cli -- prepare-mission transaction.json
npm run orchestrator:cli -- submit-report transaction.json
npm run orchestrator:cli -- reconcile-worktrees transaction.json
npm run orchestrator:cli -- rollback-mission transaction.json
npm run orchestrator:cli -- purge-worktree transaction.json
npm run ctxroute:query -- query.json
```

Transactions require `operation_id`, `expected_revision`, `action`, and a
bounded payload. Repeating the same operation identifier, action, and complete
canonical payload is safe even when the supplied expected revision has become
old. Reusing an operation identifier with any payload or action difference is
rejected before physical effects. Transactions persist `PENDING` intent before
Git mutation, then converge to `COMPLETED` or `BLOCKED`.

The goal runner launches `goal-planner` as a short read-only process and
validates the returned `GoalPlan` before creating durable state. Dependency-
ready missions run with bounded local `codex`, `claude`, or test-only `fixture`
adapters. Selection uses `CTXROUTE_WORKER_RUNTIME`, project configuration, host
detection, then local availability. Arbitrary executable paths are refused.

If a selected local skill is missing, the original mission remains unchanged
in `WAITING_FOR_SKILL`. A separate `skill-creator` mission runs in its own
worktree, then a separate read-only `blueprint-audit` process reviews it.
Repair reruns the creator in that worktree. Acceptance triggers integration,
main-checkout digest recomputation, `skill.register`, and resumption of the
original mission. Workers cannot register skills themselves.

## Mission and evidence contracts

JSON Schema 2020-12 is canonical. `MissionRequest` is the accepted request,
`MissionRecord` is orchestrator-owned state, and `MissionView` is the
positive worker projection. A worker view contains the goal identity and title,
mission identity, relative file scope, skill/version, acceptance criteria,
structured validations, `response_format: worker-report`, and its managed
worktree reference. This gives the worker the objective as well as the
implementation boundary without exposing global conversation. Conversation,
prompts, reasoning, history, and raw environment are rejected. Active missions
with overlapping scopes are rejected before work;
distinct concurrent missions receive distinct worktrees.

Mission status transitions include `WAITING_FOR_SKILL`, `PREPARING`,
`ASSIGNED`, `RUNNING`, `VALIDATING`, `INTEGRATING`, and terminal or recovery
states. `COMPLETED` is reserved for a validated change whose integrated commit
is present on the main checkout.

A worker report declares `mission_id`, skill identity, touched files,
validation claims, a short summary, bounded evidence references, and blockers.
Report intake compares it with the actual worktree diff and rejects out-of-
scope or mismatched changes. The orchestrator then reruns every declared
validation with executable/argument arrays and no shell. It stores only bounded,
redacted result metadata. It then stages only the verified scope, creates one
deterministically attributed commit, checks mainline path conflicts, and
cherry-picks non-interactively. A conflict is aborted and the worktree plus
recovery evidence are preserved as `NEEDS_ATTENTION`.

After all missions integrate, a read-only `goal-auditor` produces the criterion
→ evidence → mission matrix. `accept` completes the goal, `repair` adds bounded
corrective missions within the original deadline, and `reject`, timeout, or
insufficient evidence blocks the goal with a deterministic resume action.

An audit report contains a typed subject, categorical signals, bounded evidence
references, decision (`accept | repair | reject | defer`), distinct proposed and
applied actions, structured validations, and a rollback reference.
Objective adjustments are nested inside `audit.apply`; auditors never write
orchestrator state directly.

## Recovery and safety

State is stored under ignored `.ctxroute/orchestrator/` using a
tokenized global mutation lock, file and supported directory fsync, and atomic
rename. Bootstrap runs before MCP startup and every mutating CLI operation; it
resumes `PENDING` actions before accepting ordinary work. There is one current
state contract and no migration or reset path. Symlinks, corrupt JSON, and
unknown fields are refused without deletion. Worktrees, reports, and recovery
evidence are never mutated by state loading.

Reconciliation inventories desired missions, Git registrations, directories,
cleanliness, base revisions, and locks. It automatically removes only clean
terminal worktrees. Dirty or ambiguous divergence becomes `NEEDS_ATTENTION`.
`rollback-mission` captures a bounded restorable binary patch before forced
removal; capture failure prevents removal. Destructive `purge-worktree` exists
only in the CLI and requires orchestrator authority, a unique operation ID,
reason, and exact mission-ID confirmation. It is never exposed through MCP or
hooks.

Limits apply to bytes, time, parallel worktrees, free disk, telemetry, and
rollback evidence rather than arbitrary workflow step counts. Worktrees isolate
concurrent write sets but are not sandboxes.

Decision events are appended locally as mode-0600 JSONL with byte rotation.
The orchestrator emits one causally identified event per validation and transition, including
bounded policy/schema identifiers, expurgated schema location, evidence digest,
Git OID, outcome, and duration metadata only.
Append and Windows-compatible rotation share a lock. Prompts, conversation, private reasoning,
environment dumps, raw output, file contents, and credentials are forbidden.
Transactional state remains authoritative if telemetry fails.

Stop is fail-open, honors `stop_hook_active`, reports bounded diagnostics, and
never requests automatic continuation; the goal runner owns continuation until
a terminal goal state. Run `npm run blueprint:review` after
changes made by any skill or audit path, then `npm run verify` before delivery.
