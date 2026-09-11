---
name: methodical-corrector
description: Diagnose and correct reproducible visual, runtime, adapter, package, or activation defects when an active artifact, source-of-truth trace, bounded hypothesis, and regression evidence are required.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: primary-or-orchestrator
---

# Methodical corrector

Use this skill for a real defect, a regression, a failed activation, an output
that differs from its source, or two unsuccessful attempts on the same symptom.
Do not use it for an unobserved speculative refactor.

## Required evidence

Read `docs/methodical-correction.md`, the applicable product contracts, and
`docs/templates/correction-record.schema.json`. Create a bounded correction
record outside Git or under an explicitly requested receipt directory. Label
every input as `source`, `implementation`, `observation`, or `hypothesis`.

Before product edits:

1. Reproduce one symptom and state one expected result.
2. Identify the exact package, entry, interface, binary, PID, and hashes with
   `node scripts/verify-active-theme.mjs` when a theme runtime is involved.
3. Trace source → adapter → canonical contract → package → loader → runtime →
   renderer. Mark every unknown; an unknown is not evidence.
4. Select exactly one owning layer: source adapter, canonical contract,
   runtime, connector, or private package.
5. State one falsifiable hypothesis and the observation that would reject it.

## Correction loop

Change the smallest owning layer. Never compensate in a downstream layer for
data that was already lost upstream. Never invent an offset, scale, socket,
capability, menu, fallback, or success receipt. Preserve source cardinality,
orientation, coordinate space, units, provenance, and unsupported states.

Run the closest deterministic test first. Regenerate derived artifacts from an
immutable input; do not hand-edit generated or private resolved output. Verify
the newly produced hashes before restart. Stop the prior bounded process,
activate the verified artifact once, then collect the declared visual matrix.

If the same hypothesis fails twice, stop patching and return to the trace. Do
not broaden the edit or stack another guessed value.

## Acceptance

A correction is `DONE` only when the targeted assertion passes, the relevant
regression set passes, the active hashes match the tested hashes, and required
visual observations are recorded. Compilation without runtime evidence is
`PARTIAL`. Missing source truth, unavailable required instrumentation, or a
failed acceptance observation is `BLOCKED` or `FAILED`, never inferred success.

Review the final diff for unrelated changes, hidden hardcode, private content,
lossy conversion, stale processes, documentation impact, and rollback. Run
`node scripts/verify-correction-record.mjs <record.json>` for the final record.

Return one status, the falsified or confirmed hypothesis, changed owning layer,
commands and exit codes, active artifact receipt, visual evidence, remaining
unknowns, and rollback reference.
