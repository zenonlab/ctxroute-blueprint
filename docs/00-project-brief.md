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

### Local Progress dashboard

The blueprint control plane includes an optional local dashboard for the
versioned Progress checklist. Its users are the developer and coding agent in
one workspace; it serves every approved goal, hides completed goals by default,
and permits only the mutations already authorized by `progress-core`. It is not
a product frontend or a hosted service.

The implementation is dependency-free JavaScript on Node.js 22.13+, with a
responsive HTML/CSS/JavaScript interface and a local HTTP server addressed by
the `localhost` hostname on an ephemeral port. `.project/progress.json` remains
the only durable data source. Ephemeral PID, instance, URL, session marker, and
token state stays ignored under `.ctxroute/state/`.

The server accepts only local Host and Origin values, requires a random bearer
token for every API request, limits JSON bodies, emits no request log, serves
only bundled resources under a restrictive CSP, and expires after inactivity.
Optimistic revisions reject stale mutations with HTTP 409. There is no remote
deployment, account, telemetry, cloud synchronization, or availability target;
recovery is a safe local restart through the Progress MCP.
Startup also self-repairs the generated Markdown view from the JSON revision;
stale lock and recovery-marker owners are reclaimed only when their process is
dead, with bounded retries and token-checked release.

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

For the blueprint control plane, the Progress dashboard succeeds when its real
HTTP and MCP tests cover local access controls, plan validation and creation,
immutable plan identity, mutable status/evidence/mode, revision conflicts,
classified manual reasons, generated-view crash recovery, lock recovery, idle
expiry, instance reuse and Stop session deduplication. The complete
repository validation, internal Archify validation, and CRG gate must pass.
