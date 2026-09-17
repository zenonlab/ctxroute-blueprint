# CTXRoute orchestration

CTXRoute remains the local context engine. Context is requested explicitly
through `ctxroute_context_query` or the mirror CLI instead of being injected on
every tool call. The query returns bounded references and never serializes the
global conversation into a worker mission.

## Modes

The canonical default is `SWARM + STANDARD`. `SWARM` permits a deterministic
stage, one worker, parallel workers, or an independent auditor according to the
resolved stage plan. `AUTO` selects the smallest compatible mode. `SOLO` keeps
durable worktree isolation with one active agent. `GUARDED` works on the current
checkout with durable scope and evidence. `DIRECT` has no goal or worktree but
retains Git, architecture, and security protections.

Persistent mode changes affect new goals only. Each active goal freezes its
requested/resolved mode, workflow, strategies, reinforcements, and
`policy_digest`. A safe `goal.policy.rebase` transaction is required to change
that policy. Historical `SWARM_ON` and `SWARM_OFF` values are read as `SWARM`
and `DIRECT`; `CTXROUTE_SWARM_MODE`, `defaultMode`, and `mode.set` remain
deprecated read/API aliases.

Workflows are `STANDARD`, `RESEARCH`, `AUDIT`, `SECURITY`, `MIGRATION`,
`INCIDENT`, `EXPERIMENT`, and `RECOVERY`. Research and audit are read-only.
Experiments stop at `READY_FOR_PROMOTION`; recovery never interprets age as
permission to delete.

Mission requests declare `execution: auto | direct | coordinated`. `direct`
never allocates a worktree, `coordinated` always uses a mission, and `auto` may
apply the bounded scope heuristic while returning its structured reason.

## Local interfaces

Codex and Claude expose `ctxroute-orchestrator` over stdio. The CLI calls the
same service and is the emergency path when MCP is unavailable:

```sh
npm run orchestrator:read
npm run orchestrator:doctor
npm run orchestrator:cli -- modes
npm run orchestrator:cli -- explain-execution request.json
npm run orchestrator:cli -- pending-decisions
npm run orchestrator:cli -- resolve-decision receipt.json
npm run orchestrator:cli -- promote-experiment receipt.json
npm run orchestrator:cli -- mutate transaction.json
npm run orchestrator:cli -- prepare-mission transaction.json
npm run orchestrator:cli -- submit-report transaction.json
npm run orchestrator:cli -- commit-mission transaction.json
npm run orchestrator:cli -- integrate-mission transaction.json
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

If a selected local skill is missing, mission preparation automatically routes
one bounded mission to `skill-creator`. After its blueprint audit passes, the
orchestrator records the result with `skill.register`; workers cannot perform
that registration themselves.

## Mission and evidence contracts

JSON Schema 2020-12 is canonical. Operating/workflow descriptors, stage plans,
resolved policies, checkpoints, decision receipts, experiment receipts, and
outcome receipts are public closed contracts. `MissionRequest` is the accepted request,
`MissionRecord` is orchestrator-owned state, and `MissionView` is the
positive worker projection. A worker view contains only mission identity,
relative file scope, skill/version, acceptance criteria, structured
validations, `response_format: worker-report`, and its managed worktree
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

Workers have a closed Git read-only allowlist. They cannot stage, commit,
create or move references, allocate worktrees, integrate, fetch, push, or run
maintenance. After validation, `commit-mission` creates the commit inside the
managed worktree and records its exact OID. `integrate-mission` accepts only
that OID and cherry-picks it on the primary checkout while holding the single
`repositoryMutationLock`. Both effects persist `PENDING` intent first, so
bootstrap can converge after interruption without inventing a second commit.

An audit report contains a typed subject, categorical signals, bounded evidence
references, decision (`accept | repair | reject | defer`), distinct proposed and
applied actions, structured validations, and a rollback reference.
Objective adjustments are nested inside `audit.apply`; auditors never write
orchestrator state directly.

Every accepted stage transition writes a `StageCheckpoint` containing only
closed identifiers, the frozen digest, completed receipt IDs, bounded artifact
references, and the exact next stage. A human decision request and its
checkpoint are one atomic transaction. Resolution validates the digest and
continues at that next stage without replaying accepted stages. Raw model
memory, prompts, and conversation history are never checkpointed.

Goal completion is an effect check, not a status shortcut. Read-only outcomes
must provide an existing report/evidence reference and match the repository
baseline. Mutating outcomes must name a commit already reachable from primary
`HEAD`. Recovery outcomes must name existing backup evidence and the verified
final repository digest. Experiment outcomes require a promotion receipt and
successful integration first.

## Recovery and safety

State is stored under ignored `.ctxroute/orchestrator/` using the portable
`repositoryMutationLock`, file and supported directory fsync, and atomic
rename. Bootstrap runs before MCP startup and every mutating CLI operation; it
resumes `PENDING` actions before accepting ordinary work. There is one current
state contract and no migration or reset path. Symlinks, corrupt JSON, and
unknown fields are refused without deletion. Legacy mode values are accepted
without destructive rewriting. Worktrees, reports, and recovery
evidence are never mutated by state loading.

Hooks consume an atomic, digest-verified policy envelope smaller than 16 KiB.
They try the current snapshot, then its last-valid copy, then a freshly
resolved canonical `SWARM + STANDARD` policy. If none is verifiable, only
mutation tools are denied, with mode, workflow, stage, digest, categorical
cause, invariant, and a concrete recovery command. Codex and Claude adapt the
same internal decision separately: policy denials use the host JSON contract;
a Claude hook infrastructure failure uses stderr plus exit 2 and never mixes
that exit with JSON.

Reconciliation inventories desired missions, Git registrations, directories,
cleanliness, base revisions, and locks. It automatically removes only clean
terminal worktrees. Dirty or ambiguous divergence becomes `NEEDS_ATTENTION`.
`rollback-mission` captures a bounded restorable binary patch before forced
removal; capture failure prevents removal. Destructive `purge-worktree` exists
only in the CLI and requires orchestrator authority, a unique operation ID,
reason, exact mission-ID confirmation, and a matching explicit
`DecisionReceipt`. It is never exposed through MCP or hooks. Recovery also
inventories unmanaged or stale worktrees, divergent branches, interrupted Git
operations, and unreachable commits. Age is evidence for review, never
authority to delete or rewrite a reference.

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

The implementation evidence matrix is maintained in
[`orchestration-verification.md`](orchestration-verification.md). Architectural
rationale is split by concern: ADR-0087 defines the three-level model,
ADR-0088 covers stages and human resumption, ADR-0089 covers repository
authority and outcome proofs, and ADR-0090 covers atomic snapshots and host
adapters.

Stop is fail-open, honors `stop_hook_active`, reports bounded diagnostics, and
never requests automatic continuation. Run `npm run blueprint:review` after
changes made by any skill or audit path, then `npm run verify` before delivery.
