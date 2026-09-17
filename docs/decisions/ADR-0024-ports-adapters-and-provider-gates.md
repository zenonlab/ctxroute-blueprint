---
scope:
  - docs/architecture/**
  - docs/systems/**
  - docs/workflows/**
  - docs/ci.md
  - apps/**
  - packages/**
  - scripts/infra/**
  - package.json
  - .github/**
review: on-change
revised: true
---
# ADR-0024 — Ports, adapters, and provider operation gates

- Status: accepted
- Date: 2026-09-02
- Revised: 2026-09-05

## Context

Browser APIs, IndexedDB libraries, content sources, and cloud providers are
likely to change. Direct calls from product rules would spread provider
semantics throughout the codebase and make migrations expensive.

## Decision

Organize the product as domain, application use cases, owned ports, and outer
adapters. Dependencies point inward. Browser, storage, network, telemetry, and
clock capabilities cross named ports. Provider SDKs are allowed only in their
adapter packages.

All infrastructure mutations pass through one project-owned operational gate
with `inspect`, `plan`, and `apply` phases. `apply` requires an approved fresh
plan and an explicit account/resource allowlist. CI may inspect and plan but
does not deploy production automatically.

The gate core is provider-neutral and owns canonical plan hashing, a maximum
30-minute lifetime, exact approval-digest matching, and account/resource
allowlists. Before mutation it repeats inspection and preview and rejects any
state or dry-run drift. The Cloudflare driver alone translates those operations
to Wrangler. It derives Worker, D1, and R2 resource names from the checked-in
Worker configuration; product use cases and runtime adapters never import the
operational driver.

The driver permits D1 migration application, Worker deployment, and publication
of the two version-derived Chrome/Firefox archives to the configured release
bucket. It inspects authentication, current deployment, pending migrations, and
every configured R2 bucket. Before approval, each release archive is read and
its size and SHA-256 enter the preview digest; apply rejects changed bytes.
D1 migrations run first, release objects second, and the Worker deployment
last. No generic R2 key, bucket deletion, or arbitrary local path is accepted.
Adding another R2 mutation or provider still requires an explicit driver
operation and its contract tests; it does not expand the generic gate.

The retired Queue inventory is separate from active Worker bindings. When it is
non-empty, deletion refuses any active or undeclared Queue and still requires a
fresh plan digest plus the exact Queue allowlist. The one-entry
`tobirink-jobs-production` inventory was cleared after the approved deletion.

## Consequences

Provider replacement is concentrated in adapters and operational drivers.
There is deliberate ceremony around new integrations, but dependency-cruiser
rules and adapter contract tests make the boundary executable.
