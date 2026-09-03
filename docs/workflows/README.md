# Workflows

## Progress and Stop

The Progress MCP is the durable source for goals, mutable step status, evidence,
and the active per-goal mode. Goals are `automatic` by default, so Stop reports
remaining tickets without preventing the agent from ending its turn.
`manual` is a targeted pause classified as `visual-review` or
`important-decision` for a consequential choice not already made by the user. Routine feature
implementation, tests, and documentation remain automatic. In either mode, a
goal whose unfinished steps are all `BLOCKED` produces a non-blocking handoff.
`stop_hook_active` prevents recursive continuation loops.

For multi-agent work, each independent step is a ticket. An agent calls
`progress_status`, then `progress_next` or `progress_claim_ticket`, and performs the work without intermediate tracking
writes, and calls `progress_update_step` once with its final status and evidence.
Claims and all other mutations use the same short filesystem lock, so parallel
agents cannot overwrite one another. Contenders retry with bounded jitter to
absorb local bursts without forming a retry convoy. A busy MCP still fails
after about one second; work may continue and the agent reconciles its ticket
afterward. Mutation replies are compact.

Subagents use an automatic specialization of this flow. `SubagentStart` hashes
the harness, parent session, and agent identities, then claims the first `TODO`
ticket from an `automatic` goal and injects its full contract. `SubagentStop`
requires a final, unfenced `PROGRESS_RESULT` JSON line with `DONE` or `BLOCKED`
and bounded non-empty evidence. A missing, malformed, oversized, secret-bearing,
or empty-evidence result returns only that owned ticket to `TODO`. `SessionEnd`
releases only `IN_PROGRESS` claims carrying its session prefix. Replays are
idempotent, and all mutations use the existing lock. Main-agent sessions do not
claim automatically; their explicit MCP flow remains the portable fallback.
The full checklist is available only through the voluntary JSON resource
`ctxroute://progress/full`; it is not an automatically selectable tool.
`npm run progress:read` remains the human diagnostic path.

Stop mentions Archify only when an Archify source is already part of the
change. A diagram is needed only when a material boundary, public contract,
dependency, or cross-component flow changes; ordinary feature code does not
trigger one by filename heuristic.

`progress_open_dashboard` starts or reuses a durable local dashboard without
launching a browser. The default server has no idle expiration. Its fragment
token moves into tab-scoped `sessionStorage`, so reloading the same tab remains
authenticated after the fragment is removed. The first Stop in a Codex session
that still has an unfinished goal adds the authenticated URL to `systemMessage`;
later Stops reuse a marker keyed by a hash of `session_id`. A newly created
replacement instance is announced again, while completed-only checklists do not
start a server. Dashboard errors remain visible and fail open without changing
the continuation decision.

The browser loads all goals from `.project/progress.json` through
`progress-core`, with completed goals hidden by default. Plan creation validates
before writing. Switching to manual opens a reason dialog and persists either
`visual-review` or `important-decision`; automatic mode clears that reason.
Step status and short evidence remain mutable;
approved titles, criteria, files, and commands do not. Every response includes
an optimistic revision, and HTTP 409 requires the browser to reload before
retrying.

`docs/progress.md` is a derived view carrying the JSON revision. CLI, MCP, and
dashboard startup repair it atomically when it is missing or stale. Both the
main lock and its recovery marker identify their owner by PID and token so a
dead stale owner can be reclaimed without disturbing a live or recent one.

## File change to CRG update

CTXRoute's PostToolUse dispatcher calls the CRG handler only after a successful
normal write. The handler acquires an atomic lock and runs
`update --skip-flows`; if `graph.db` is absent it performs the initial build.
Concurrent calls skip while one update is active. A 30-second timeout, bounded
stdout/stderr, and fail-open diagnostics keep agent work responsive.

SessionStart checks graph status or builds missing state. A healthy graph adds
no context; only a bounded diagnostic is emitted when CRG fails open.
PreToolUse permits generated graph maintenance and
`apply_refactor_tool` only with `dry_run: true`; real changes continue through
normal editing tools and all CTXRoute/Sensor controls.

The architecture JSON IR is the executable diagram source for this flow.
