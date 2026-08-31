# Technology decisions

This page is both the decision record for this blueprint and a reusable
advisory matrix for a derived project. A choice is a recommendation, not a
default to copy blindly: first record the project context, then compare the
cost of the choice with the cost of changing it later.

## Context to collect before recommending a stack

| Signal | Questions to answer | Why it changes the recommendation |
| --- | --- | --- |
| Product shape | CLI, library, web app, mobile app, worker, data pipeline, or embedded system? | Determines the runtime, delivery model, UI, and operational boundary. |
| Users and traffic | Who uses it, how many concurrent users, what latency and availability are required? | Separates a local single-process design from a service, queue, cache, or multi-region system. |
| Data | What is stored, for how long, at what volume, with what consistency, privacy, and recovery needs? | Drives the database, backup, retention, migration, and encryption decisions. |
| Integration boundary | Which APIs, browsers, devices, queues, files, or third-party services are required? | Makes external dependencies, failure modes, contracts, and ownership explicit. |
| Team and lifecycle | Which languages are already operated, how fast must the team ship, and who owns production? | A familiar boring stack often beats a theoretically optimal stack with a higher support cost. |
| Risk and compliance | What happens if data is disclosed, changed, lost, or unavailable? Which regulations apply? | Determines threat modelling, identity, auditability, isolation, and verification depth. |
| Delivery and operations | Where does it run, how is it deployed, observed, rolled back, and upgraded? | Prevents selecting infrastructure the team cannot reliably operate. |
| Change profile | What is expected to change most: UI, domain rules, integrations, data model, or scale? | Favors modularity at the unstable boundary and simplicity elsewhere. |

Use the answers as evidence in the project brief. Revisit a decision when a
signal crosses its original assumption; do not introduce a service or a
framework only because it is common in another project.

## Base decision matrix for project construction

| Topic | Project choice | Context and trade-off | Recommendation rule | ADR / evidence |
| --- | --- | --- | --- | --- |
| Language | To decide from project context | Compare ecosystem fit, team ownership, runtime guarantees, delivery targets, and long-term maintenance. | Prefer the language the team can operate reliably unless a measurable product constraint outweighs migration cost. | Record an ADR or brief evidence. |
| Runtime | To decide from project context | Check execution model, latency, concurrency, memory, native modules, platform support, and lifecycle policy. | Choose the smallest runtime surface that satisfies the product constraints and support policy. | Record versions and support/EOL policy. |
| Frontend | To decide whether a UI is needed | A UI adds accessibility, browser/device support, state, performance, and release concerns. | Use no frontend for non-interactive products; choose a framework only when interactive user value and ownership are explicit. | Record user-flow and accessibility evidence. |
| Backend | To decide whether a service is needed | A hosted backend adds identity, API contracts, deployment, availability, and data-protection obligations. | Keep behavior local when there is no shared state or remote workflow; add a service for shared coordination or controlled access. | Record trust boundaries and data flows. |
| Storage | To decide from data needs | Compare volume, consistency, concurrency, recovery, retention, privacy, tenancy, replication, and operational ownership. | Start with the least operationally expensive store that meets those needs; validate backup and recovery before scaling up. | Record schema, recovery, and migration evidence. |
| Deployment | To decide from availability and delivery needs | Identify environment, rollback path, secrets boundary, release frequency, ownership, and cost. | Match deployment complexity to availability and release requirements; do not treat CI as production hosting. | Record environment and rollback evidence. |
| Observability | To decide from operator questions | Define the signals needed to diagnose failures and measure behavior, with correlation, redaction, cost, and retention controls. | Emit the minimum useful logs, metrics, and traces needed to answer those questions. | Record signal and alert requirements. |

## Research anchors

These sources provide durable prompts for the advisory process; they are not
prescriptive stack choices:

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/): identify components, trust boundaries, security requirements, and verifiable controls.
- [OWASP threat modelling guidance](https://owasp.org/www-community/Threat_Modeling_Process): assess threats and countermeasures when architecture or data flows change.
- [Twelve-Factor backing services](https://12factor.net/backing-services) and [config](https://12factor.net/config): keep dependencies and environment-specific configuration explicit and replaceable.
- [OpenTelemetry observability signals](https://opentelemetry.io/docs/concepts/signals/): choose logs, metrics, and traces from the operational questions they must answer.
- [SQLite WAL documentation](https://sqlite.org/wal.html): verify concurrency and deployment assumptions before choosing a local SQLite store.

When a recommendation depends on project-specific facts, cite those facts in
the project brief or an ADR rather than presenting the recommendation as a
universal rule.
