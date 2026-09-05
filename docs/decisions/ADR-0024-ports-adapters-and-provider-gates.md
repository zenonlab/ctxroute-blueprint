---
scope:
  - docs/architecture/**
  - docs/systems/**
  - docs/workflows/**
  - docs/ci.md
  - apps/**
  - packages/**
  - scripts/infra/**
  - .github/**
review: on-change
---
# ADR-0024 — Ports, adapters, and provider operation gates

- Status: accepted
- Date: 2026-09-02

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

## Consequences

Provider replacement is concentrated in adapters and operational drivers.
There is deliberate ceremony around new integrations, but dependency-cruiser
rules and adapter contract tests make the boundary executable.
