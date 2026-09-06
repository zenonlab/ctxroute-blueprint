# Workflows

## Orchestrator and Stop

The orchestrator is the sole writer for global goals and worker missions.
`SWARM_ON` prepares minimal contracts and isolated worktrees; `SWARM_OFF`
executes directly without coordination artifacts. Stop is always fail-open,
honors `stop_hook_active`, may record an explicitly supplied worker report,
cleans CTXRoute session state, and never requests automatic continuation.

## File change to CRG update

CRG updates are explicit or asynchronous rather than a synchronous per-tool
context injection. PreToolUse permits generated graph maintenance and
`apply_refactor_tool` only with `dry_run: true`; real changes continue through
normal editing tools and Sensor controls. CTXRoute context lookup is available
on demand through MCP and CLI.

The architecture JSON IR is the executable diagram source for this flow.
