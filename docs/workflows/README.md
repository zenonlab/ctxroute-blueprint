# Workflows

## Progress and Stop

The Progress MCP is the durable source for approved goals, mutable step status,
evidence, and the active per-goal mode. Goals are collaborative by default.
After approval, the agent may offer autonomous execution once; only explicit
user confirmation activates it. In collaborative mode Stop returns a compact
handoff with up to three next steps. In autonomous mode Stop requests
continuation until every step is `DONE`, or hands off a documented external
blocker. In either mode, a goal whose unfinished steps are all `BLOCKED`
produces a non-blocking handoff and never triggers another Stop loop or an
autonomous-mode offer. `stop_hook_active` prevents recursive continuation loops.

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
`progress-core`, with completed goals hidden by default. Plan approval and mode
changes require confirmation. Step status and short evidence remain mutable;
approved titles, criteria, files, and commands do not. Every response includes
an optimistic revision, and HTTP 409 requires the browser to reload before
retrying.

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
