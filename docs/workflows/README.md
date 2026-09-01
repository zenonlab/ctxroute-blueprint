# Workflows

## File change to CRG update

CTXRoute's PostToolUse dispatcher calls the CRG handler only after a successful
normal write. The handler acquires an atomic lock and runs
`update --skip-flows`; if `graph.db` is absent it performs the initial build.
Concurrent calls skip while one update is active. A 30-second timeout, bounded
stdout/stderr, and fail-open diagnostics keep agent work responsive.

SessionStart checks graph status, builds missing state, and injects one short
instruction. PreToolUse permits generated graph maintenance and
`apply_refactor_tool` only with `dry_run: true`; real changes continue through
normal editing tools and all CTXRoute/Sensor controls.

The architecture JSON IR is the executable diagram source for this flow.
