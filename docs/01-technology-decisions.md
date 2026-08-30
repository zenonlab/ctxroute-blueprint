# Technology decisions

| Topic | Choice | Rationale | ADR |
| --- | --- | --- | --- |
| Language | JavaScript ES modules; Python only as an ephemeral external command | Reuses Node.js blueprint infrastructure and prevents a persistent Python runtime | ADR-0005 |
| Runtime | Node.js 22 and npm 10 | Matches existing CTXRoute, Sensor, and CI support | ADR-0005 |
| Frontend | None | Generated Archify HTML is documentation output, not an application frontend | ADR-0005 |
| Backend | None | All behavior is local CLI/workspace orchestration | ADR-0005 |
| Storage | SQLite with WAL for CRG state | Local state with safe concurrent readers | ADR-0006 |
| Deployment | GitHub repository and cross-platform GitHub Actions | The blueprint has no hosted runtime | ADR-0005 |
| Observability | Stable JSON diagnostics plus bounded lifecycle logs | Automation and troubleshooting without leaking secrets | ADR-0006, ADR-0007 |
