---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/**
  - .project/project-config.json
  - apps/**
  - packages/**
  - package.json
  - package-lock.json
review: on-change
---
# ADR-0023 — Extension-first TypeScript stack

- Status: accepted
- Date: 2026-09-02

## Context

Tobirink's authoritative workflows run inside a browser extension and private
data should remain local. The project needs cross-browser packaging without
making the extension framework the product architecture.

## Decision

Use strict TypeScript, Node.js 24 LTS product tooling, npm workspaces, WXT
0.21.x pinned exactly, React 19, CSS Modules, Dexie-backed IndexedDB, Zod 4,
Vitest, and Playwright. Keep WXT inside the extension delivery adapter and keep
React inside UI entrypoints. Domain and application packages import neither.

Use a minimal Hono Cloudflare Worker only for optional anonymous public
capabilities. Do not introduce Rails, Next.js, accounts, server-side private
library synchronization, Durable Objects, or queues until an approved use case
requires them.

## Consequences

The first implementation is one TypeScript system with shared contracts and a
small operational surface. WXT's pre-1.0 risk is contained by exact pinning,
adapter contract tests, and an explicit upgrade ADR. Rails remains a later
option if server-centred product requirements emerge.
