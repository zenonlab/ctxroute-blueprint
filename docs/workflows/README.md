# Workflows

## Orchestrator and Stop

The orchestrator is the sole writer for global goals and worker missions.
`SWARM_ON` routes every mutation through `orchestrator_run_goal`: planner,
dependency-ready local workers, validation, orchestrator-owned commit and
cherry-pick, then goal audit. A missing skill uses a
creator/auditor/register/resume saga without replacing the original mission.
`SWARM_OFF` executes directly without coordination artifacts. Stop is always fail-open,
honors `stop_hook_active`, may record an explicitly supplied worker report,
cleans CTXRoute session state, and never requests automatic continuation; the
goal runner retains the loop.

## File change to CRG update

CRG updates are explicit or asynchronous rather than a synchronous per-tool
context injection. After a successful `apply_patch`, `Edit`, or `Write`, the
host starts the lifecycle `maintenance` lane asynchronously. That lane contains
only `post-tool-crg.mjs`, coalesces bursts, and uses the runner's cross-process
single-flight lock; generic shell tools never schedule it. The synchronous lane
still returns Sensor and audit diagnostics immediately to the agent.

`npm run crg:health` is the machine-readable readiness check. It compares the
ignored graph's build commit with `HEAD`; stale or missing state always points
to `npm run crg:update`. An incremental no-op after a merge falls back once to
a bounded full build because the upstream no-op does not refresh commit
metadata. Agents obtain current minimal context and impact data on demand
through the allowlisted official MCP tools. PreToolUse permits
`apply_refactor_tool` only with `dry_run: true`; accepted edits remain normal
editor operations so all lifecycle controls execute.

The architecture JSON IR is the executable diagram source for this flow.
