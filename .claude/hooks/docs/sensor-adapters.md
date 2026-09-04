---
match: [".githooks/sensor", ".githooks/ast-registry.mjs", ".project/sensor-rules.json"]
mode: once
---
# Sensor adapter registry

The blueprint Sensor works without installing a product framework. Read the
Sensor checklist and ADR-0010 before changing its registry, rules, or
dependencies.

Preserve the single registry and Sensor engine, stable diagnostic contract,
explicit unsupported-language errors, and CTXRoute/SQLite boundaries. Adding a
parser or changing a rule requires architecture evidence, an applicable ADR,
tests, and validation; it must not modify `AGENTS.md`, global permissions, or
CTXRoute configuration automatically. Language-specific constraints are routed
separately and should not be generalized to an unrelated product stack.
