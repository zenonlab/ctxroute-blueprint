# Workflows

## File change to CRG update

The Node.js watcher receives a file event, coalesces a short burst, and hands a
single update request to the ephemeral CRG runner. The runner starts
`uvx code-review-graph update` with a fixed argument vector, records the result,
and exits. SQLite is opened in WAL mode for the duration of the update and is
closed before the runner reports completion. SIGINT and SIGTERM stop new work,
terminate the active child, close resources, and exit cleanly.

The architecture JSON IR is the executable diagram source for this flow.
