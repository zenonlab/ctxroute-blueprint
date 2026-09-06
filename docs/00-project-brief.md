# Project brief

This repository is the stack-neutral CTXRoute blueprint itself. It is not a
product project and must not initialize a frontend, backend, storage, or cloud
deployment by default. Product decisions remain placeholders for a derived
repository.

## Summary

- Name: `[project name]`
- Problem solved: `[the user or business problem]`
- Users: `[primary users, operators, and stakeholders]`
- In scope: `[capabilities delivered by this project]`
- Out of scope: `[explicit exclusions and future work]`
- Product shape: `[CLI, library, web app, mobile app, worker, pipeline, or other]`

## Discovery context

- Expected usage and traffic: `[users, concurrency, latency, availability]`
- Data and lifecycle: `[data types, volume, retention, consistency, recovery]`
- Integrations: `[APIs, devices, browsers, queues, files, providers]`
- Team and ownership: `[skills, operators, support model, delivery cadence]`
- Risk and compliance: `[privacy, regulatory, abuse, loss, and availability risks]`
- Deployment environments: `[local, cloud, on-premises, edge, mobile, or mixed]`
- Expected change: `[UI, domain, integration, data, or scale changes]`

## Constraints

- Performance: `[budgets, latency, throughput, memory, and scale limits]`
- Security: `[trust boundaries, identity, secrets, abuse cases, and verification]`
- Reliability: `[availability, failure recovery, backup, and graceful shutdown]`
- Platform: `[supported operating systems, devices, runtimes, and browsers]`
- Delivery: `[release, migration, rollback, and support constraints]`

## Template-provided baseline

The blueprint supplies repository governance, CTXRoute context routing,
official code-review-graph v2.3.8, Archify documentation validation, and a
separate Sensor for static diagnostics. Sensor language packs are exact,
project-local dependencies; setup synchronizes declared packs, while hooks and
analysis never install from the network. Tooling requires Git, Node.js 22.13+,
npm 10+, Python 3.10+, and uv 0.11.2; Python 3.12 is the reference CRG runtime.
These are template constraints, not product architecture choices. A derived
project may adapt them only through the approved initialization and cleanup
process.

### Local orchestration boundary

The blueprint control plane is a local Node.js tool exposed through stdio MCP,
CLI commands, Git worktrees, and ignored files under `.ctxroute/`. It has no
HTTP endpoint, dashboard, hosted runtime, account system, remote deployment, or
application availability target. The orchestrator owns revisioned goals,
missions, validation receipts, audit records, and recoverable worktree
operations; workers receive only the bounded mission projection they need.

Git worktrees isolate checkout and index state, not hostile processes. The
security boundary assumes cooperative local agents. Any future remote,
multi-tenant, adversarial, externally served, or production-SLA requirement
must reopen the architecture and threat model before adding a service plane or
stronger sandbox.

## Decisions

- Language: `[choice and reason]`
- Runtime: `[choice, supported versions, and lifecycle policy]`
- Frontend: `[choice or explicitly none, with user-flow evidence]`
- Backend: `[choice or explicitly none, with trust-boundary evidence]`
- Storage: `[choice, consistency, recovery, and migration strategy]`
- Deployment: `[environments, release, rollback, and ownership]`
- Observability: `[logs, metrics, traces, alerts, redaction, and retention]`
- Security: `[threat model, controls, and verification level]`
- Performance: `[budgets and validation method]`

See [`docs/01-technology-decisions.md`](01-technology-decisions.md) for the
questions, trade-offs, and research anchors used to make these decisions.

## Success criteria

- `[observable product outcome]`
- `[quality and security acceptance criteria]`
- `[operational readiness and recovery criteria]`
- `[architecture, tests, and cross-platform CI evidence]`

For the blueprint control plane, success requires schema-validated V2 state and
messages, deterministic crash/replay and multi-process coverage, orchestrator-
owned validation receipts, non-destructive worktree reconciliation, bounded
redacted telemetry, internal Archify validation, and a blocking CRG `high`
risk gate. The complete repository validation must pass without introducing an
HTTP, daemon, Kubernetes, GitOps-runtime, hardware-simulation, LLM, or network
dependency into orchestration tests.
