---
scope:
  - package.json
  - package-lock.json
review: on-change
contracts:
  - docs/ci.md
---
# ADR-0095 — Development tooling update

- Status: accepted
- Date: 2026-09-22

## Decision

Advance the reviewed development-tooling set to Oxlint and its official plugin
bundle 1.83.0, and Skills 1.7.0. Keep all other dependency pins unchanged.
The lockfile is regenerated and committed with the manifest so local and CI
installs resolve the same artifacts.

## Alternatives

Keeping the previous tooling versions was rejected because it would leave the
blueprint behind the reviewed Dependabot update. Updating packages separately
was rejected because it would make the lockfile and manifest inconsistent.

## Consequences

The repository validation gate must remain green after the update. A future
tooling change requires the same manifest-and-lockfile review and an ADR in its
commit when contract files change.
