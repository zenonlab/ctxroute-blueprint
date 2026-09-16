---
name: goal-auditor
description: Audit an orchestrated goal after mission integration by mapping every acceptance criterion to concrete mission, validation, and Git-diff evidence.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: read-only-review
---

# Goal auditor

Inspect the bounded goal, its criteria, mission receipts, validation results,
and the cumulative repository diff from the recorded base revision. Do not
mutate files or orchestrator state.

Return only `GoalAcceptanceReport`. Mark a criterion `PROVED` only when its
evidence exists in the main checkout and names the responsible integrated
mission. Use `repair` with narrowly scoped, non-overlapping missions when the
goal remains safely repairable. Use `reject` when evidence is insufficient or
the requested result cannot be established. Never infer success from a worker
summary alone.

When the mission includes a satisfied documentation evidence report, verify
every external claim against its current ledger and return every source used in
`documentation_source_ids`. Reject the goal when no applicable ledger source
covers an external claim.
