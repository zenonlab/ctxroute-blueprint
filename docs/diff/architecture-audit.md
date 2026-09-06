# Architecture audit

Audit date: 2026-09-06. Scope: the checked-out `main` tree at `eb4b822`; repository runtime was not modified. This blueprint is local agent-orchestration tooling, not an HTTP application framework.

This document preserves the observations at that audited revision. The current
remediation addendum below records their disposition; it does not rewrite the
historical evidence as though the defects had never existed.

## Evidence labels

- **Repository fact**: directly observed in a versioned file.
- **Test proof**: behavior exercised by a passing deterministic test; proof does not extend beyond the fixture.
- **Recommendation**: proposed target, not an implemented capability.
- **Industry analogy**: transferable idea, not evidence about this repository.
- **Unverified hypothesis**: plausible behavior not exercised or externally confirmed.

Line references identify the audited revision and can move after later edits.

## Audited architecture

| Responsibility | Actual authority and implementation | Evidence class |
| --- | --- | --- |
| Global state | `scripts/orchestrator-core.mjs` is the mutation core. The audited state contains revision, mode, goals/missions, skills, audits, and transaction receipts (`:16-18`, `:55-76`). | Repository fact |
| Interfaces | MCP and CLI call the same service; transport is stdio/local files, not HTTP (`scripts/orchestrator-mcp.mjs:7-17`, `scripts/orchestrator-cli.mjs:4-20`). | Repository fact; MCP path test-proved by `tests/mcp-stdio.test.mjs:24-38` |
| Worker view | A worker read is reduced to mission ID, scope, skill/version, acceptance, validation commands, response format, and worktree (`scripts/orchestrator-service.mjs:6-13`). Mission injection omits global history (`.codex/hooks/mission-context.mjs:7-25`). | Repository fact; absence is structural, not a process sandbox guarantee |
| Git isolation | A detached linked worktree is created at current `HEAD`; changed paths are compared with declared scopes (`scripts/worktree-manager.mjs:7-30`). | Repository fact; happy path test-proved at `tests/orchestrator-core.test.mjs:53-70` |
| Lifecycle | Session start reconciles worktrees and injects a mission; Stop attempts restitution, resets CTXRoute, then performs fail-open review (`.codex/hooks/lifecycle.mjs:20-33`, `:81-131`). | Repository fact |
| Skills | Three local skills are declared and statically validated: `blueprint-audit`, `session-auditor`, `skill-creator` (`scripts/validate-blueprint-skills.mjs:5-31`). | Repository fact; validator command passed |
| Audit | `session-audit.mjs` streams bounded JSONL, redacts secret-like material, compares selected evidence, and returns a compact audit contract (`scripts/session-audit.mjs:7-37`, `:44-106`). | Repository fact; test-proved at `tests/session-audit.test.mjs:8-41` |

### Transaction and state contract

The command envelope requires a safe `operation_id`, non-negative `expected_revision`, action, object payload, and no secret-like key/value (`scripts/orchestrator-core.mjs:227-242`). Under a lock, the core checks a stable digest, rejects changed replays and stale revisions, increments the revision, writes a mode-0600 temporary file, calls file `fsync`, and renames it (`:55-76`, `:277-310`). The test proves same-command replay, changed-payload refusal, revision conflict, and survival of an unrelated orphan `.tmp` (`tests/orchestrator-core.test.mjs:23-33`).

Validation is equivalent imperative validation, not a formal JSON Schema. Root state checks goals, missions and skill registrations, but does not validate the detailed shape of `audits` or `transactions`, reject unknown fields, or rescan loaded state for secrets (`scripts/orchestrator-core.mjs:98-115`). The MCP Zod schema constrains only the generic envelope and leaves `payload` open (`scripts/orchestrator-mcp.mjs:8`).

Mission fields actually used are: documented inputs plus implicit `status`, `report`, `worktree`, `base_revision`, and optional `requested_skill_id` (`scripts/orchestrator-core.mjs:151-174`; `scripts/orchestrator-service.mjs:65-82`). Only exact top-level keys `history` and `conversation` are forbidden (`scripts/orchestrator-core.mjs:197-204`); the positive worker projection is the stronger boundary.

Worker reports require identity, touched paths, command/exit-code pairs, summary, material evidence and blockers, within 64 KiB and secret checks (`scripts/orchestrator-core.mjs:79-87`). Intake verifies the actual Git diff and required command names, but does not execute commands or verify evidence references (`scripts/orchestrator-service.mjs:45-58`; `scripts/orchestrator-core.mjs:164-175`). Audit reports are similarly bounded but their decision vocabulary and evidence semantics are free text (`scripts/orchestrator-core.mjs:90-95`).

### Authority boundary

Service methods reject global mutation and mission preparation when `CTXROUTE_AGENT_ROLE=worker`; a worker may report only its assigned mission (`scripts/orchestrator-service.mjs:45-58`, `:85-87`). Tests prove this service boundary (`tests/orchestrator-core.test.mjs:95-101`). This is not security isolation: worktrees share a repository and the process retains filesystem/process/network powers. A worker capable of importing the core or editing files is not cryptographically prevented from bypassing the service. The correct claim is **policy and API authority**, not impossibility under hostile execution.

## Execution flows

| Path | Observed sequence | Failure/contingency behavior |
| --- | --- | --- |
| `SWARM_ON`, coordinated | Read state → route skill → optional bypass → create detached worktree → transact `mission.prepare` → worker report → inspect diff → transact report. | Transaction failure after creation triggers forced removal. A process crash between worktree creation and transaction leaves an orphan until reconciliation (`scripts/orchestrator-service.mjs:20-42`). |
| Simple task short-circuit | A known-skill mission with fewer than two scope entries bypasses mission/worktree creation (`scripts/orchestrator-service.mjs:27-29`). | The heuristic measures scope-array length, not task complexity; unverified for semantically complex one-scope tasks. |
| `SWARM_OFF` direct | Persisted `state.mode=SWARM_OFF` bypasses preparation with no ticket/worktree (`scripts/orchestrator-service.mjs:22-25`). | Test-proved for persisted mode (`tests/orchestrator-core.test.mjs:35-41`). The documented per-process environment override is read by `currentSwarmMode`, but `prepareMission` reads `state.mode`; end-to-end override behavior is therefore not proved and appears inconsistent (`scripts/orchestrator-core.mjs:46-53`). |
| Missing skill | Rewrites the mission to `skill-creator`, scopes it to the new skill directory, and requires skill validation plus blueprint review (`scripts/orchestrator-service.mjs:65-77`). | Routing and later `skill.register` are test-proved (`tests/orchestrator-core.test.mjs:103-115`), but registration does not verify file existence or proof that blueprint-audit passed (`scripts/orchestrator-core.mjs:145-150`). |
| Replay/conflict | Core replay compares the action/payload digest before revision; stale new operations fail (`scripts/orchestrator-core.mjs:61-68`). | `prepareMission` has a pre-core replay path comparing selected mission fields only; it ignores `goal_id`, worktree/base revision and extra payload fields (`scripts/orchestrator-service.mjs:30-33`, `:80-82`). This is weaker than the documented full-payload rule. |
| Invalid/secret report | Imperative validators reject malformed, oversized, or secret-like reports before state mutation. | Test covers one secret-like audit value, not the full key/value/path matrix (`tests/orchestrator-core.test.mjs:85-93`). |
| Audit/goal adjustment | `audit.apply` appends a report and may update goal title/status in the same transaction (`scripts/orchestrator-core.mjs:177-192`). | No formal decision enum, legal transition table, inverse transaction, or patch existence check. |
| Cancellation/recovery | Mission status can transition to `CANCELLED`; next SessionStart reconciliation removes inactive trees. | Any status can transition to any status. There is no explicit rollback/recovery action exposed by MCP/CLI. |

### Failure-branch coverage

| Branch | Existing behavior | Proof status |
| --- | --- | --- |
| Worktree unavailable / Git subprocess timeout | Synchronous Git command fails; preparation propagates the error. | Code-observed only; no deterministic injected failure test. |
| Overlapping scopes | Prefix/equality overlap with any active mission is rejected. | Test-proved for one overlap (`tests/orchestrator-core.test.mjs:118-135`). No symlink/case/filesystem-normalization proof. |
| Failed validation / incomplete report | Missing required command blocks intake; nonzero reported exit or blockers sets mission `BLOCKED`. | Happy report is proved; missing/failed report branches are mostly code-observed. Commands are reported, not executed. |
| Process crash | Temp-state rename protects the previous JSON; stale locks have no owner/age recovery. | Orphan temp presence is tested, crash timing is not. |
| Concurrent transaction | Exclusive lock plus expected revision serializes in-process callers. | Revision conflict is tested sequentially; no multi-process race/lock-timeout test. |
| Partially written state | Same-directory temporary + file `fsync` + rename; directory is not fsynced. | Code-observed; power-loss durability is unverified and platform-dependent. |

### Isolation and reconciliation

`reconcileManagedWorktrees` treats `ASSIGNED`, `RUNNING`, and `BLOCKED` mission trees as active. It force-removes registered inactive trees, prunes Git metadata, then recursively deletes well-named unregistered directories under the managed root (`scripts/worktree-manager.mjs:43-69`). The test proves preservation of an active tree and removal after cancellation (`tests/orchestrator-core.test.mjs:72-83`).

This differs materially from the narrative that automatic cleanup refuses dirty worktrees and force is reserved for an explicit rollback (`docs/orchestration.md:65-70`; `docs/decisions/ADR-0022-universal-ctxroute-orchestration.md:68-76`). No rollback transaction exists. Cleanup, explicit rollback, and destructive forced deletion are currently conflated.

Configured limits are 512 KiB state, 64 KiB report, 16 KiB context, 2 s lock wait, 30 s subprocess, and eight worktrees (`.project/orchestrator-config.json:1-14`). No disk quota or free-space check exists. Git worktrees isolate checkout/index write sets, not filesystem credentials, processes, network, refs, config, or secrets.

### Skills and audit boundaries

- `blueprint-audit` is a read-only review instruction, but its mechanical reviewer checks only a bounded file list and three doctrine patterns (`.agents/skills/blueprint-audit/SKILL.md:11-25`; `scripts/blueprint-review.mjs:6-23`). It does not prove every declared requirement.
- `session-auditor` implements streaming, byte/time/depth bounds, value/key redaction, compact output, and active-trace skipping. It accepts arbitrary supplied paths and has no canonical-root, regular-file, symlink, or explicit self-trace exclusion (`scripts/session-audit.mjs:10-22`, `:40-55`). No automatic invocation was found; non-recurring behavior is repository-observed, not a validated invariant.
- `skill-creator` requires primary-source labels, deterministic validation and blueprint-audit before orchestrator registration (`.agents/skills/skill-creator/SKILL.md:15-34`). The static validator does not execute declared validation commands or validate authority/research labels (`scripts/validate-blueprint-skills.mjs:16-29`).

### HOOTL and telemetry

The existing orchestration tests already use temporary real Git repositories and predetermined reports, with no LLM or application network call (`tests/orchestrator-core.test.mjs:137-161`). This is a useful HOOTL seed, not a complete bench. Missing deterministic fixtures include injected Git failure/timeout, malformed report variants, actual out-of-scope diff, multi-process revision conflict, crash at each worktree/state-write boundary, stale lock, dirty cleanup, rollback/resume, and idempotent repeated reconciliation.

At the audited revision, decision telemetry was fragmented: state receipts stored operation ID, digest and revision; missions/reports stored mode indirectly, skill/version, command names and exit codes; session audit stored categorical signals; hook performance separately measured durations (`scripts/orchestrator-core.mjs:69-73`; `scripts/hook-performance.mjs:36-59`). There was no single structured event with transition, execution mode, duration, Git before/after, block cause, and audit decision. No private reasoning should be added.

### CI and governance coherence

Actions are SHA-pinned and permissions are narrow (`.github/workflows/validate.yml:13-46`; `.github/workflows/code-review-graph.yml:7-32`). However:

- documentation still attributes an HTTP Progress dashboard/runtime to the blueprint (`docs/00-project-brief.md:47-70`, `:94-99`) although ADR-0022 removes Progress; this is documentation debt, not a current HTTP capability;
- two active files use ADR number 0022, and semantic contradictions are not caught by the ADR validator;
- `docs/ci.md:3-12` overstates push coverage and cross-platform CRG smoke relative to `.github/workflows/validate.yml:3-7`, `:70-81`;
- the workflow step is still named “Progress MCP” while executing the orchestrator MCP smoke (`.github/workflows/validate.yml:66-68`);
- `docs/02-quality-strategy.md:17` cites nonexistent `npm run hooks:performance`, and its crash/multi-process recovery row is a target rather than current proof;
- the CRG workflow configures `fail-on-risk: none` (`.github/workflows/code-review-graph.yml:26-33`) while `docs/ci.md:37-44` describes a blocking high-risk threshold.

## Findings and priorities

1. **P0 — formal contracts:** publish JSON Schema 2020-12 for state/envelope/mission/worker/audit, align Zod and imperative validation, and test unknown fields, replay equality, transitions, secrets and loaded-state integrity.
2. **P0 — deterministic HOOTL:** turn the existing temp-Git fixture into a fault-injectable, network-free bench covering the failure matrix above.
3. **P1 — reconciliation/rollback:** inventory before action; make automatic cleanup non-destructive; expose separately authorized rollback and forced deletion; record outcomes; make every transition retry-safe.
4. **P1 — structured telemetry:** append bounded redacted events with IDs, revisions, transition/mode/skill, validation result, duration, exit status, Git revisions and categorical cause.
5. **P2 — artifact generation:** progressively validate skill-produced artifacts and the evidence chain before transactional registration.
6. **P3 — heavy industrial mechanisms:** no resident controller, hardware simulation, application canary, Kubernetes dependency, or HTTP framework unless a measured operational need appears.

## Remediation addendum

The accepted remediation moves persistence and public messages directly to
schema, consolidates full-payload transaction replay, adds orchestrator-owned
validation, recoverable two-phase worktree operations, bounded decision
telemetry, and a deterministic network-free HOOTL bench. Documentation and CI
now describe only stdio/CLI/local-file interfaces and the actual Linux-full,
macOS/Windows-smoke matrix. CRG `high` is blocking.

P3 remains deliberately unimplemented. ADR-0027 defines the evidence that must
exist before considering hostile-agent isolation, remote multi-tenancy,
production SLA machinery, an external API, or application workload delivery.
Risk-by-risk implementation and test evidence is maintained in
[remediation-closure.md](remediation-closure.md).

Remaining unverified boundaries are arbitrary-filesystem behavior under power
loss and containment of a hostile worker process. They are not claimed as
solved by local deterministic fixtures.
