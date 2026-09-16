---
name: goal-planner
description: Convert one bounded operational goal into non-overlapping, dependency-aware worker missions with complete acceptance-criterion coverage before any repository mutation begins.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: read-only-planning
---

# Goal planner

Read the supplied goal, acceptance criteria, suggested paths, project
configuration, applicable ADRs, and available skill catalogue. Do not mutate
files, create worktrees, or persist the prompt.

Return only the declared `GoalPlan`. Give every acceptance criterion a stable
`criterion-N` identifier in request order and map it to at least one mission.
Missions must have non-overlapping repository-relative scopes, explicit
dependencies, a concrete existing or proposed skill path, bounded validations,
and enough objective context to execute without conversation history.

Prefer the smallest coherent mission graph. Reject hidden global context,
arbitrary executable paths, shell-shaped validations, dependency cycles, and
plans whose scopes overlap.
