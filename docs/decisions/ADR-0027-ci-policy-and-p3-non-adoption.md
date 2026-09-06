---
scope:
  - .github/workflows/**
  - package.json
  - scripts/check-coherence.mjs
  - docs/02-quality-strategy.md
  - docs/orchestration.md
review: on-change
revised: true
contracts:
  - .project/orchestrator-config.json
---
# ADR-0027 — CI policy and non-adoption of industrial runtime controls

- Status: accepted
- Date: 2026-09-06

## Decision

CRG is blocking at `high`. Linux runs the complete repository gate; macOS and
Windows run bounded compatibility smokes. CI executes on pushes to `main`, all
pull requests, and manual dispatch. Documentation and coherence checks must use
those exact claims and name the stdio boundary “orchestrator MCP”.

The local cooperative-agent threat model does not justify HTTP APIs, daemons,
Kubernetes, runtime GitOps, hostile sandboxing, hardware simulation, canaries,
or production service machinery. These P3 controls are explicitly not adopted.
Reopen the decision only when at least one of these facts becomes real: hostile
agents, remote multi-tenancy, a production SLA, an external API requirement, or
an application workload rather than blueprint-local tooling.

## Consequences

The blueprint keeps deterministic local process and filesystem boundaries.
Platform smokes must not be described as complete gates, and historical
Retired dashboard/runtime capabilities must not appear in active operational guidance.
