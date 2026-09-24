# Durable orchestration verification map

This document is the release checklist for the modular orchestration design.
An item is complete only when its runtime evidence and named test both exist.
Passing a narrower unit test is not evidence for a broader invariant.

| Area | Required runtime evidence | Required verification |
|---|---|---|
| Pure resolver | Closed status, deterministic digest, monotone permission/requirement/floor/access merge, satisfiability classification | Generative combinations plus differential `explain-execution` test |
| Frozen goals | Complete resolved policy stored with a recomputed digest; global mode changes do not alter it | Mode-change/no-split-brain test |
| Stage engine | Current stage advances once through the frozen graph; read-only access enforced | Crash/replay test at every transition |
| Human decision | Atomic checkpoint before wait; one compatible receipt resumes its recorded next stage after process death | Fresh-process decision test and double-consumption rejection |
| Experiment | Retained worktree and experiment receipt at `READY_FOR_PROMOTION`; no integration before explicit promotion | Negative integration test followed by promotion test |
| Outcome | Read-only snapshot unchanged; mutation commit reachable from primary HEAD; recovery backup/final inventory; experiment promotion consumed | Real Git completion tests for every effect |
| Git authority | Every shared Git effect runs inside `repositoryMutationLock`; workers use read-only allowlist | Multiprocess allocation, commit, integration, rollback, purge, and per-runtime worker denial tests |
| Portable workers | Only CTXRoute starts assigned, non-overlapping missions within `parallelWorktrees`; adapter output never bypasses report validation | Fake Codex, Claude, and OpenCode executables; parallel temporary Git worktrees; root-binding and invalid-output tests |
| Recovery | Inventory includes worktrees, divergent branches, interrupted operations, and unreachable commits; no age-based deletion | Dirty recovery with bounded patch and explicit destructive receipt |
| Hook snapshot | Atomic policy under 16 KiB, independent envelope/policy digest validation, last-valid and fail-closed mutation fallback | Corrupt/missing/oversized snapshot tests |
| Execution binding | Worker policy, stage, access, digest, and revision come from durable mission state; contradictory environment is rejected | Writable/read-only stage, stale revision, wrong digest, and missing mission tests |
| Hook lanes | Synchronous, host-async maintenance, and manual handlers match both manifests; maintenance is executed and coalesced | Structural manifest validation plus real lane process tests |
| Effect governance | Observation/maintenance are allowed; resolution/repair require orchestrator authority; protection persistence requires a receipt; telemetry is categorical and bounded | Governance, memory, CRG, and reconciliation tests |
| Host adapters | Host-neutral decision translated separately for Codex and Claude; Claude never receives JSON with exit 2 | Real dispatcher contract tests including `Stop` |
| Performance | One Node process per event, direct handler imports, early read-only filtering | Ten-sample p95: 250/500/100 ms |
| Compatibility | Legacy mode/config aliases are read without destructive rewrite; canonical writes only | Legacy state/config fixtures |
| Documentation | ADR-0087 through ADR-0092, orchestration runbook, and Archify flows agree with runtime contracts | ADR, docs, coherence, and Archify validators |

Release requires `npm run verify`, `git diff --check`, and an audit that maps
every row above to current command output. Any missing or indirect evidence is
an open defect, not a warning.
