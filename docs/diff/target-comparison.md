# Current-to-target comparison

The target preserves the local Node.js/stdin/filesystem design. It adds explicit contracts and testability, not a new service plane.

## Comparison matrix

| Area | Current, evidenced state | Proposed target | Priority / compatibility |
| --- | --- | --- | --- |
| State contract | Imperative partial `validateState`; audits/receipts and unknown fields are weakly checked. | Canonical JSON Schema 2020-12 plus a single strict Ajv 8 adapter; validate on read and before write. | P0; keep one current contract and reject corrupt state. |
| Transaction envelope | Revision CAS and digest replay in core; weaker special replay in mission service. | One envelope validator and one digest/replay path over the complete canonical payload. | P0; retain operation IDs and revision semantics. |
| Mission | Minimal worker projection exists; implicit status/report/worktree/base revision/requested skill. | Separate `MissionRequest`, orchestrator-owned `MissionRecord`, and worker-visible `MissionView`. | P0; closed state machine and `worker-report`. |
| Worker report | Bounded shape, diff/scope and command-name checks; result is self-reported. | Formal enum/status, bounded arrays and evidence references; orchestrator reruns structured validations without a shell and records its own receipt. | P0; only an orchestrator receipt can complete a mission. |
| Audit report | Bounded free-text decision and subject. | Decision enum, categorical signals, evidence refs, explicit proposed/applied action, validation result and rollback reference. | P0; validate the current shape strictly. |
| Worker authority | Enforced at service/environment boundary. | Keep API authority wording; add capability-limited process sandbox only if threat model requires it. | P0 documentation correction; no sandbox claim. |
| Simple bypass | Scope-count heuristic. | Explicit `execution: direct|coordinated` decision plus recorded reason; heuristic may remain a default. | P1; additive. |
| Environment mode | Resolver supports env override, mission preparation uses persisted state. | Resolve mode once per request and record source (`environment|state|default`). | P1; preserve persisted behavior. |
| Skill creation | Correct routing shape; later registration is syntactic only. | Registration requires an existing validated manifest and referenced blueprint-audit receipt in the same transaction. | P1; reject registrations outside the current contract. |
| Worktree creation | Physical creation precedes mission transaction. | Journal intent first or record a recoverable allocation phase; reconcile `desired ↔ observed` states. | P1; state-machine extension. |
| Cleanup / rollback | Reconciliation force-deletes inactive/unknown managed trees. | `inspect` → safe clean removal; dirty tree becomes `needs_attention`; explicit rollback and separately explicit destructive purge. | P1; safer behavior, potentially leaves more disk until resolved. |
| Limits | Bytes, time and worktree count; no disk enforcement. | Add minimum free-space/budget observation and bounded telemetry retention. | P1; configurable and disabled-compatible. |
| HOOTL | Temp Git + predetermined report happy paths. | Fault-injectable fake command runner/clock/process boundary; zero network/LLM; table-driven crash/retry cases. | P0; test-only. |
| Telemetry | Receipts, reports, audit signals and performance output are separate. | JSONL `DecisionEvent`, redacted and bounded, with no prompts, chain-of-thought or raw secrets. | P1; opt-in then default-local. |
| CI/doc governance | Strong pinned CI, but stale narratives and shallow semantic checks. | Contract negative fixtures, ADR-number uniqueness, command-existence/coherence checks, docs/diff required sources. | P1; documentary/test changes only. |
| Industrial analogy | Epsilon3/Kubernetes/GitOps are not dependencies. | Retain only version/approval/as-run and desired/observed reconciliation concepts. | P3; no controller, cluster or HTTP adoption. |

## Proposed contracts

The accepted target publishes one stable `$id` contract for every produced
object. The orchestrator neither migrates nor resets incompatible state.
Corrupt or unknown state fails closed without removing worktrees, reports, or
recovery evidence.

Suggested definitions:

```text
TransactionEnvelope
  operation_id, expected_revision, action, payload

MissionRequest
  mission_id, skill_id, skill_version, file_scope,
  acceptance, validation_commands, response_format

MissionRecord (orchestrator-owned)
  MissionRequest + status, worktree, base_revision,
  requested_skill_id?, report?, allocation_state?

MissionView (worker-visible)
  explicit allowlist projection; never conversation/history fields

WorkerReport
  mission_id, skill_id, skill_version, files_touched,
  commands[{command, exit_code}], summary, material_evidence, blockers

AuditReport
  sessions_examined, signals_detected, subject,
  decision, patch_applied, validations, rollback
```

Use `$schema` and `$id`, explicit `required`, array/item bounds, enums, path
patterns and `unevaluatedProperties: false` for every object. `readOnly`
annotations never substitute for service authorization.

OpenAPI is not proposed: its defined scope is HTTP APIs, while this blueprint exposes stdio MCP, CLI and local files. If an HTTP surface is deliberately added later, it requires a separate decision and threat model.

Minimal telemetry proposal:

```json
{
  "event_id": "evt-...",
  "operation_id": "mission-prepare-one",
  "revision_before": 1,
  "revision_after": 2,
  "entity": { "type": "mission", "id": "mission-one" },
  "transition": { "from": null, "to": "ASSIGNED" },
  "mode": "SWARM_ON",
  "skill": { "id": "blueprint-audit", "version": "1.0.0" },
  "validation": { "status": "passed", "exit_code": 0 },
  "duration_ms": 37,
  "git": { "before": "<oid>", "after": "<oid>" },
  "outcome": "accepted",
  "cause": null
}
```

Prohibit prompt text, private reasoning, environment dumps, raw stdout/stderr and credentials. Bound strings/arrays, redact before serialization, and rotate by bytes.

## Priority order

1. Formal mission/report/audit and state/envelope contracts.
2. Deterministic local HOOTL bench.
3. Worktree reconciliation and rollback separation.
4. Structured decision telemetry.
5. Progressive artifact-generation validation.
6. Heavy industrial mechanisms only after demonstrated operational demand.
