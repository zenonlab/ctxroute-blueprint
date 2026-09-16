---
scope:
  - scripts/agent-governance.json
  - scripts/agent-governance.mjs
  - .codex/hooks/**
  - .claude/hooks/**
review: on-change
revised: true
---
# ADR-0007 — Agent governance and control-loop boundaries

- Status: accepted
- Date: 2026-08-30

## Context

Routing, middleware, memory, MCP/A2A, and agent loops need explicit authority
boundaries while CTXRoute, Archify, and Sensor remain existing infrastructure.

## Decision

Classify actions as follows: in-scope repository routing and middleware changes,
scoped context injection, audit diagnostics, bounded execution, local state, and
clean shutdown are ALWAYS and proceed without a conversational permission gate.
ASK is reserved for user-owned or personal memory persistence, external side
effects, and new MCP/A2A connections (including routing or middleware changes
outside the governed repository). NEVER refuses secret exfiltration, safety
bypasses, global agent settings, persistent daemons, and other unapproved
mutations. The control loop may plan, mutate through governed local adapters,
and validate autonomously.

## Alternatives

Implicit permissions are difficult to audit. A broad agent superuser model
would weaken the blueprint's safety boundary. Duplicating issue #7 would split
ownership of multilingual post-hook analysis.

## Consequences

Governance is explicit and testable. Routine local work is autonomous; only
explicitly classified external or user-owned effects require an extra approval
step. The policy is versioned as JSON and evaluated by a short-lived Node.js
CLI; it does not grant access to memory or MCP/A2A providers by itself.

Successful hook validations are silent. Lifecycle context is bounded; Sensor
diagnostics remain visible while full reports belong in CI or local
validation output.
Deterministic safety gates run before a mutation. PostToolUse analysis reports
against the already-modified file without rejecting or hiding the successful
tool result. The lifecycle dispatcher has two closed lanes: `synchronous`
contains the bounded Sensor, audit, and agent-context handlers; `maintenance`
contains only coalesced, fail-open work that must not delay the tool response.
Hosts declare the maintenance command as asynchronous and pass the lane to the
same dispatcher, so the configuration cannot bypass lifecycle planning. CRG
incremental maintenance is the first such handler. It runs only after a
successful `apply_patch`, `Edit`, or `Write`, never after generic shell tools.
