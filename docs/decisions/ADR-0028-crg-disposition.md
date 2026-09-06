---
scope:
  - .github/schemas/crg-risk-acceptance.schema.json
  - .github/workflows/code-review-graph*.yml
  - scripts/crg-disposition.mjs
  - tests/crg-disposition.test.mjs
review: on-change
revised: true
contracts:
  - .github/schemas/crg-risk-acceptance.schema.json
---
# ADR-0028 — Privileged CRG disposition

- Status: accepted
- Date: 2026-09-06

## Decision

Branch protection consumes `CRG disposition`, not the untrusted analyzer job.
The analyzer keeps `fail-on-risk: high` and exports a bounded report bound to PR
and head SHA. A privileged workflow never checks out PR code. It validates the
artifact and report digest, passes risk below `high`, and otherwise requires an
`APPROVED` review on the exact SHA from a repository administrator other than
the PR author. The review body supplies a 32–512 character justification and a
tracking issue reference. Accepted high/critical risk produces a bounded
`CrgRiskAcceptance` attestation. A new SHA or report digest cannot reuse it.

The acceptance review must contain `Justification:`, a tracking issue, and
`CRG-report-sha256:<digest>`. This is the only exceptional acceptance path;
there is no local configuration or CLI waiver.

## Consequences

Risk remains visible and blocking at `high`. Administrator acceptance is
auditable, cannot be self-approved by the PR author, and expires with either
the analyzed commit or report bytes.
