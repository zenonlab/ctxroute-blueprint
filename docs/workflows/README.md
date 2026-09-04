# Workflows

## Progress and Stop

Progress is an ordered, durable memory of goals, coherent milestones, evidence,
and the active per-goal mode. It is not a task scheduler. Goals are `automatic`
by default, so Stop stays silent and never prevents the agent from ending its turn.
`manual` is a targeted pause classified as `visual-review` or
`important-decision` for a consequential choice not already made by the user. Routine feature
implementation, tests, and documentation remain automatic. In either mode, a
goal whose unfinished steps are all `BLOCKED` produces a non-blocking handoff
only when `external:` evidence qualifies a genuine outside dependency.
`stop_hook_active` prevents recursive continuation loops.

Prefer two to six outcome-sized milestones in their logical order. Files,
commands, commits, and routine edits are not milestones. Only genuinely
parallel milestones carry `claimable: true`; an explicit agent can call
`progress_claim_ticket`, work without intermediate tracking writes, and call
`progress_update_step` once with its final status and evidence. `progress_next`
preserves plan order and returns blocked context separately.
Claims and all other mutations use the same short filesystem lock, so parallel
agents cannot overwrite one another. Contenders retry with bounded jitter to
absorb local bursts without forming a retry convoy. A busy MCP still fails
after about one second; work may continue and the agent reconciles its ticket
afterward. Mutation replies are compact.

Subagents use this specialization only when started with the explicit
`progress-worker` agent type. `SubagentStart` hashes the harness, parent session,
and agent identities, then claims the first claimable `TODO` milestone from an
`automatic` goal and injects its contract. Other subagents remain untouched.
`SubagentStop`
requires a final, unfenced `PROGRESS_RESULT` JSON line with `DONE` or `BLOCKED`
and bounded non-empty evidence. A missing, malformed, oversized, secret-bearing,
or empty-evidence result returns only that owned ticket to `TODO`. `SessionEnd`
releases only `IN_PROGRESS` claims carrying its session prefix. Replays are
idempotent, and all mutations use the existing lock. Main-agent sessions do not
claim automatically; MCP is their rich optional interface and the matching
`npm run progress:*` command is an equivalent emergency/local fallback.
The full checklist is available only through the voluntary JSON resource
`ctxroute://progress/full`; it is not an automatically selectable tool.
`npm run progress:read` remains the human diagnostic path.

Stop mentions Archify only when an Archify source is already part of the
change. A diagram is needed only when a material boundary, public contract,
dependency, or cross-component flow changes; ordinary feature code does not
trigger one by filename heuristic.

`progress_open_dashboard` voluntarily starts or reuses a durable local dashboard without
launching a browser. The default server has no idle expiration. Its fragment
token moves into tab-scoped `sessionStorage`, so reloading the same tab remains
authenticated after the fragment is removed. Stop never starts or advertises
the dashboard. `npm run progress:close` stops the current repository's instance
and is safe to replay.

The browser loads all goals from `.project/progress.json` through
`progress-core`, with completed goals hidden by default. Plan creation validates
before writing. Switching to manual opens a reason dialog and persists either
`visual-review` or `important-decision`; automatic mode clears that reason.
Step status, claimability, short evidence, approved titles, criteria, files,
and commands remain explicitly mutable. Every response includes
an optimistic revision, and HTTP 409 requires the browser to reload before
retrying.

`docs/progress.md` is a derived view carrying the JSON revision. CLI, MCP, and
dashboard startup repair it atomically when it is missing or stale. Both the
main lock and its recovery marker identify their owner by PID and token so a
dead stale owner can be reclaimed without disturbing a live or recent one.

## File change to CRG update

CTXRoute's asynchronous PostToolUse maintenance lane calls CRG only after a
successful structured file edit, never after a shell read or test command. The
handler acquires an atomic lock and runs
`update --skip-flows`; if `graph.db` is absent it performs the initial build.
Concurrent calls skip while one update is active. The hook runs in the
background; a 30-second timeout, bounded output, and fail-open diagnostics keep
the agent's tool path responsive. Archify preview and problem memory share that
non-blocking maintenance lane.

SessionStart checks graph status or builds missing state. A healthy graph adds
no context; only a bounded diagnostic is emitted when CRG fails open.
PreToolUse permits generated graph maintenance and
`apply_refactor_tool` only with `dry_run: true`; real changes continue through
normal editing tools and all CTXRoute/Sensor controls.

The architecture JSON IR is the executable diagram source for this flow.
