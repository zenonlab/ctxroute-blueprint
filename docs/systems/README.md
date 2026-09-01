# Systems

## Workspace foundation

The root npm project owns shared commands and discovers the three repository
packages through stable workspace globs. It preserves Node.js 22 and the
template lifecycle so a clean clone can run the same commands.

## Official CRG runtime

The Python project in `packages/code-review-graph/` pins CRG 2.3.8 through a
frozen uv lock. Public npm commands invoke `uv run --project ... --frozen`.
The runner owns a 30-second child timeout, bounded output, and a cross-process
single-flight lock. The official graph lives in ignored
`.code-review-graph/graph.db`; no watcher, daemon, or synthetic journal exists.

## Sensor separation

Tree-sitter dependencies and the shared language registry belong only to the
blocking Sensor. Official CRG independently owns code-context parsing and MCP
tools. This separation prevents either context engine from bypassing security
validation.

## Agent governance

The governance contract classifies routing, middleware, memory, MCP/A2A, and
control-loop actions as ASK, NEVER, or ALWAYS. Existing CTXRoute, Archify, and
Sensor infrastructure remains the source of context, architecture evidence,
and static safety diagnostics.
