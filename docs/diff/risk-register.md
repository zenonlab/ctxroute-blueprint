# Risk register

## Scoring

Severity: Critical, High, Medium, Low. Probability: High, Medium, Low. Impact describes the credible consequence within a local orchestration blueprint, not an application production SLA.

## Risks

| ID | Risk and evidence | Severity | Probability | Impact | Mitigation / owner priority |
| --- | --- | --- | --- | --- | --- |
| R-01 | Mission preparation replay compares selected fields rather than the full canonical payload (`scripts/orchestrator-service.mjs:30-33`, `:80-82`). | Critical | Medium | Changed `goal_id` or ignored extras can be accepted as replay, weakening idempotence and secret/payload guarantees. | P0: one full-envelope digest/replay path; negative replay matrix. |
| R-02 | Loaded state does not deeply validate audits/transaction receipts or unknown fields (`scripts/orchestrator-core.mjs:98-115`). | High | Medium | Corrupt/tampered state may be accepted and propagated. | P0: formal state schema, read/write validation, migration fixture. |
| R-03 | Registration does not prove the skill exists, validates, or passed blueprint audit (`scripts/orchestrator-core.mjs:145-150`). | High | Medium | Invalid/unreviewed skill identity becomes authoritative state. | P0/P1: require artifact hash plus validation/audit receipt. |
| R-04 | Worktree is created before mission state is committed (`scripts/orchestrator-service.mjs:35-41`). | High | Medium | Crash leaves unowned worktree; concurrent failure creates cleanup races. | P0 tests, then P1 allocation state/journal and idempotent reconcile. |
| R-05 | Automatic reconciliation force-removes inactive and orphan trees (`scripts/worktree-manager.mjs:43-69`) contrary to documented non-force policy. | Critical | Medium | Uncommitted evidence can be destroyed at SessionStart. | P1: inspect/dry-run by default; dirty→attention; explicit authorized purge only. |
| R-06 | Stale lock has no owner/age recovery (`scripts/orchestrator-core.mjs:297-310`). | High | Low-Medium | All later transactions time out after abrupt process death. | P0 crash fixture; P1 lock metadata and safe stale-owner recovery. |
| R-07 | Worker restriction is an API/policy boundary, not a sandbox. | High | Medium under untrusted workers; Low otherwise | A capable process can access repository/global files or network. | Correct claims now; define threat model before any OS sandbox work. |
| R-08 | Report validation trusts claimed exit codes and textual evidence; it only verifies file diff and command-name presence. | High | Medium | Mission can be marked complete without independently executed validation. | P0 report contract; P1 orchestrator-owned validation receipt. |
| R-09 | Any legal status can transition to any other; no transition graph or resume semantics. | Medium | Medium | Completed/cancelled work can be reopened silently; reconciliation decisions become ambiguous. | P0 contract enum + legal transition table and idempotent transition tests. |
| R-10 | Environment `SWARM_OFF` resolver is not used by mission preparation. | High | Medium | Documented per-process direct mode may still create/bypass based on persisted mode. | P0 HOOTL test; P1 resolve effective mode at service entry. |
| R-11 | Session auditor accepts caller-supplied paths without canonical-root/symlink policy (`scripts/session-audit.mjs:10-22`, `:40-55`). | High | Medium | It may read unintended local files; redaction is heuristic. | P0 path fixtures; P1 approved roots, regular-file/no-follow checks, explicit self-exclusion. |
| R-12 | Secret detection is regex/field-name based and loaded state is not rescanned. | High | Medium | False negatives leak; false positives block benign telemetry. | Layer formal sensitive fields, output minimization and adversarial redaction tests; never log raw payloads. |
| R-13 | No disk/free-space limit despite resource-bound narrative. | Medium | Medium | Orphan/blocked worktrees exhaust local disk. | P1 observe free bytes, configurable floor, non-destructive alert/cleanup policy. |
| R-14 | Current tests omit injected timeout/crash, actual outside-scope diff, multi-process races, dirty cleanup and resume. | High | High | Green tests overstate recovery guarantees. | P0 deterministic network-free HOOTL bench. |
| R-15 | Documentation attributes removed HTTP/Progress behavior and conflicts with current runtime/CI. | High | High | Maintainers infer nonexistent application HTTP capabilities and wrong gates. | P1 reconcile brief/ADRs/CI narrative in a separate documentation decision. |
| R-16 | Duplicate active ADR number 0022 and no semantic/number uniqueness check. | High | High | Competing decisions appear simultaneously authoritative. | P1 add uniqueness/conflict validation; explicitly supersede/renumber through governance. |
| R-17 | CI docs say blocking CRG high-risk gate while YAML uses `fail-on-risk: none`. | High | High | Expected merge protection is absent or miscommunicated. | P1 choose intended policy, then align YAML, tests and docs in one change. |
| R-18 | Telemetry lacks timestamps/durations, effective mode source, Git before/after and categorical causes. | Medium | High | Incidents cannot be reconstructed reliably without raw logs. | P1 bounded redacted `DecisionEventV1`; retention by bytes. |
| R-19 | Power-loss durability after rename is unverified; containing directory is not fsynced. | Medium | Low | Latest state file may not be durable on some filesystems. | P0 fault-model documentation/test where feasible; P1 directory sync if portability allows. |
| R-20 | Scope comparison is lexical and untested for symlinks, case folding and platform path rules. | High | Medium | Changes can be misclassified in edge filesystems. | P0 adversarial fixture matrix; canonicalize against real worktree root without following unsafe links. |

## Acceptance boundary

The original observations and scores above remain the historical baseline. V2
may close an implementation defect only when the matching contract and test in
[remediation-closure.md](remediation-closure.md) pass. Local tests do not prove
hostile-process isolation, arbitrary-filesystem power-loss durability, hosted
branch protection, or a production SLA.

No risk requires an HTTP service, Kubernetes, GitOps runtime, daemon, hardware
simulation, or canary deployment. Those mechanisms remain explicitly not
adopted under ADR-0027 until its reopening criteria are met.
