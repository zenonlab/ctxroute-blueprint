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
The lifecycle core exposes a distinct asynchronous maintenance plan for
successful editor writes. `crg:health` makes readiness explicit by comparing
the graph build commit to `HEAD` and naming `crg:update` as remediation.

## Sensor separation

Tree-sitter dependencies and the shared language registry belong only to the
blocking Sensor. Official CRG independently owns code-context parsing and MCP
tools. This separation prevents either context engine from bypassing security
validation.

## Agent governance

The governance contract classifies routing, middleware, memory, MCP/A2A, and
control-loop actions as ASK, NEVER, or ALWAYS. In-scope repository routing,
middleware, validation, audit, and bounded local state are ALWAYS: the control
loop continues without a conversational permission gate. ASK is reserved for
external effects, new connections, and user-owned memory; NEVER actions are
refused. Existing CTXRoute, Archify, and Sensor infrastructure remains the
source of context, architecture evidence, and static safety diagnostics.

## Local autonomous goal runtime

The short-lived goal runtime has no HTTP client or daemon. `goal-planner` and
`goal-auditor` are read-only processes; mission workers use closed Codex,
Claude, or fixture adapters with bounded output and deadlines. The orchestrator
alone owns state, validation, commits, cherry-picks, recovery proofs, and skill
registration.
