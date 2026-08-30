# ADR-0007 — Agent governance and control-loop boundaries

- Status: accepted
- Date: 2026-08-30

## Context

Routing, middleware, memory, MCP/A2A, and agent loops need explicit authority
boundaries while CTXRoute, Archify, and Sensor remain existing infrastructure.

## Decision

Classify actions as follows: ASK requires user approval for routing or
middleware behavior changes, external side effects, memory persistence, and
new MCP/A2A connections; NEVER permits secret exfiltration, bypassing safety
checks, changing global agent settings, or persistent unapproved daemons;
ALWAYS requires scoped context injection, audit diagnostics, bounded execution,
and clean shutdown. The control loop may plan and validate, but only approved
adapters may mutate state.

## Alternatives

Implicit permissions are difficult to audit. A broad agent superuser model
would weaken the blueprint's safety boundary. Duplicating issue #7 would split
ownership of multilingual post-hook analysis.

## Consequences

Governance is explicit and testable. Some actions require an extra approval
step, while existing infrastructure remains reusable and unchanged. The
policy is versioned as JSON and evaluated by a short-lived Node.js CLI; it does
not grant access to memory or MCP/A2A providers by itself.
