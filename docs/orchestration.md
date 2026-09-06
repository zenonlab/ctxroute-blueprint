# CTXRoute orchestration

CTXRoute remains the local context engine. Context is requested explicitly
through `ctxroute_context_query` or the mirror CLI instead of being injected on
every tool call. The query returns bounded references and never serializes the
global conversation into a worker mission.

## Modes

`SWARM_ON` is the default when no state exists. The orchestrator owns goals,
decomposition, worker missions, worktree allocation, report intake, audit
transactions, cancellation, reordering, and completion.

`SWARM_OFF` means the primary agent executes directly. It does not require a
goal, ticket, worktree, MCP call, or orchestration transaction. It does not
change skill discovery, tool access, or validation requirements.

The environment variable `CTXROUTE_SWARM_MODE` may select either mode for one
process without changing global state. Persistent mode changes use a
`mode.set` orchestrator transaction.

## Local interfaces

Codex and Claude expose `ctxroute-orchestrator` over stdio. The CLI calls the
same service and is the emergency path when MCP is unavailable:

```sh
npm run orchestrator:read
npm run orchestrator:cli -- mutate transaction.json
npm run orchestrator:cli -- prepare-mission transaction.json
npm run orchestrator:cli -- submit-report transaction.json
npm run ctxroute:query -- query.json
```

Transactions require `operation_id`, `expected_revision`, `action`, and a
bounded payload. Repeating the same operation identifier and payload is safe;
reusing it with different content or a stale revision fails.

If a selected local skill is missing, mission preparation automatically routes
one bounded mission to `skill-creator`. After its blueprint audit passes, the
orchestrator records the result with `skill.register`; workers cannot perform
that registration themselves.

## Mission and evidence contracts

A mission contains only `mission_id`, `file_scope`, `skill_id`,
`skill_version`, `acceptance`, `validation_commands`, `response_format`, and
its managed worktree reference. Conversation history is rejected. Active
missions with overlapping file scopes are rejected before work starts;
distinct concurrent missions receive distinct worktrees.

A worker report contains `mission_id`, `skill_id`, `skill_version`,
`files_touched`, commands with integer exit codes, a short summary, material
evidence, and blockers. Report intake compares the declared files with the
actual worktree diff and rejects out-of-scope changes or missing validation
commands.

An audit report contains examined sessions, detected signals, affected
skill/goal/mission, decision, applied patch, validations, and rollback.
Objective adjustments are nested inside `audit.apply`; auditors never write
orchestrator state directly.

## Recovery and safety

State is stored under ignored `.ctxroute/orchestrator/` using a local lock,
fsync, and atomic rename. Limits apply to bytes, time, parallel worktrees, and
physical resources rather than arbitrary workflow step counts. Worktrees
isolate concurrent write sets but are not sandboxes. Non-force cleanup refuses
dirty worktrees; an explicit rollback may request force after evidence is
captured.

Stop is fail-open, honors `stop_hook_active`, reports bounded diagnostics, and
never requests automatic continuation. Run `npm run blueprint:review` after
changes made by any skill or audit path, then `npm run verify` before delivery.
