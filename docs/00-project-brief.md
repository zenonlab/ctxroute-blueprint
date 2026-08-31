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

The blueprint supplies repository governance, architecture evidence, optional
CTXRoute context routing, Archify documentation validation, and a Sensor for
static diagnostics. These are tooling constraints of the template, not product
architecture choices. A derived project may keep, adapt, or remove them during
the approved initialization and cleanup process.

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
