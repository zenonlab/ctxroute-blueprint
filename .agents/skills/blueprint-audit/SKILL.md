---
name: blueprint-audit
description: Review changes to the CTXRoute blueprint, its lifecycle, orchestrator, reports, worktrees, or local skills for doctrine, security, contract, and verification regressions.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: read-only-review
---

# Blueprint audit

Derive requirements from `AGENTS.md`, applicable ADRs, the current mission, and
changed contracts. Review modifications produced by ordinary work, other
skills, the session auditor, the skill creator, and this blueprint skill
itself.

Run `npm run blueprint:review`, inspect the actual Git diff, and execute the
validation commands appropriate to the changed files. Require evidence that
Progress is absent from runtime wiring, Stop is fail-open, CTXRoute queries are
explicit and bounded, workers cannot mutate global state directly, report
schemas match their contracts, worktree changes remain in scope, both swarm
modes expose the same skills, and rollback is described.

Report each applicable requirement as conforming with evidence or missing with
a precise correction. Do not invent proof. This review may propose a patch but
must route any goal mutation through an idempotent orchestrator transaction.
