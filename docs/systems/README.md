# Systems

## Workspace foundation

The root npm project owns shared commands and discovers the three repository
packages through stable workspace globs. It preserves Node.js 22 and the
template lifecycle so a clean clone can run the same commands.

## Ephemeral CRG bridge

The watcher owns event coalescing and single-flight execution. The runner owns
the short-lived `uvx` child, bounded output, cancellation, and exit status.
SQLite/WAL is local state only; no Python daemon or remote service is allowed.

## Agent governance

The governance contract classifies routing, middleware, memory, MCP/A2A, and
control-loop actions as ASK, NEVER, or ALWAYS. Existing CTXRoute, Archify, and
Sensor infrastructure remains the source of context, architecture evidence,
and static safety diagnostics.
