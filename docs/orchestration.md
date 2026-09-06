# CTXRoute orchestration

CTXRoute remains the local context engine. Context is requested explicitly
through `ctxroute_context_query` or the mirror CLI instead of being injected on
every tool call. The query returns bounded references and never serializes the
global conversation into a worker mission.

## Modes

`SWARM_ON` is the configured default when no state exists. The orchestrator owns goals,
decomposition, worker missions, worktree allocation, report intake, audit
transactions, cancellation, reordering, and completion.

`SWARM_OFF` means the primary agent executes directly. It does not require a
goal, ticket, worktree, MCP call, or orchestration transaction. It does not
change skill discovery, tool access, or validation requirements.

The effective mode is resolved in this order: a valid
`CTXROUTE_SWARM_MODE`, the persisted mode, then the configured default. Every
decision reports `mode_source` as `environment`, `state`, or `default`.
Persistent mode changes use a `mode.set` orchestrator transaction.

Mission requests declare `execution: auto | direct | coordinated`. `direct`
never allocates a worktree, `coordinated` always uses a mission, and `auto` may
apply the bounded scope heuristic while returning its structured reason.

## Local interfaces

Codex and Claude expose `ctxroute-orchestrator` over stdio. The CLI calls the
same service and is the emergency path when MCP is unavailable:

```sh
npm run orchestrator:read
npm run orchestrator:cli -- mutate transaction.json
npm run orchestrator:cli -- prepare-mission transaction.json
npm run orchestrator:cli -- submit-report transaction.json
npm run orchestrator:cli -- reconcile-worktrees transaction.json
npm run orchestrator:cli -- rollback-mission transaction.json
npm run ctxroute:query -- query.json
```

Transactions require `operation_id`, `expected_revision`, `action`, and a
bounded payload. Repeating the same operation identifier, action, and complete
canonical payload is safe even when the supplied expected revision has become
old. Reusing an operation identifier with any payload or action difference is
rejected before physical effects. Transactions persist `PENDING` intent before
Git mutation, then converge to `COMPLETED` or `BLOCKED`.

If a selected local skill is missing, mission preparation automatically routes
one bounded mission to `skill-creator`. After its blueprint audit passes, the
orchestrator records the result with `skill.register`; workers cannot perform
that registration themselves.

## Mission and evidence contracts

JSON Schema 2020-12 is canonical. `MissionRequestV2` is the accepted request,
`MissionRecordV2` is orchestrator-owned state, and `MissionViewV2` is the
positive worker projection. A worker view contains only mission identity,
relative file scope, skill/version, acceptance criteria, structured
validations, `response_format: worker-report-v2`, and its managed worktree
reference. Conversation, prompts, reasoning, history, and raw environment are
rejected. Active missions with overlapping scopes are rejected before work;
distinct concurrent missions receive distinct worktrees.

Mission status transitions are closed: `PREPARING` may become `ASSIGNED`,
`BLOCKED`, or `CANCELLED`; `ASSIGNED` may become `RUNNING` or `CANCELLED`;
`RUNNING` may become `BLOCKED`, `COMPLETED`, or `CANCELLED`; and `BLOCKED` may
be resumed to `RUNNING` or cancelled. `COMPLETED` and `CANCELLED` are terminal.

A worker report declares `mission_id`, skill identity, touched files,
validation claims, a short summary, bounded evidence references, and blockers.
Report intake compares it with the actual worktree diff and rejects out-of-
scope or mismatched changes. The orchestrator then reruns every declared
validation with executable/argument arrays and no shell. It stores only bounded,
redacted result metadata. Only a successful orchestrator validation receipt may
move a mission to `COMPLETED`.

An audit report contains a typed subject, categorical signals, bounded evidence
references, decision (`accept | repair | reject | defer`), distinct proposed and
applied actions, structured validations, and a rollback reference.
Objective adjustments are nested inside `audit.apply`; auditors never write
orchestrator state directly.

## Recovery and safety

State schema V2 is stored under ignored `.ctxroute/orchestrator/` using a
tokenized bounded lock, file and supported directory fsync, and atomic rename.
A recognized valid V1 `state.json` is deleted and replaced with empty V2 state
on first orchestrator access; its worktrees, reports, and recovery evidence are
never deleted. Corrupt or unknown-version state is refused without deletion.

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
They contain categorical transition, validation, Git OID, mode source, outcome,
and duration metadata only. Prompts, conversation, private reasoning,
environment dumps, raw output, file contents, and credentials are forbidden.
Transactional state remains authoritative if telemetry fails.

Stop is fail-open, honors `stop_hook_active`, reports bounded diagnostics, and
never requests automatic continuation. Run `npm run blueprint:review` after
changes made by any skill or audit path, then `npm run verify` before delivery.
