---
scope:
  - docs/ui-design-contract.md
  - .project/ui-design-contract.json
  - docs/architecture/src/ui-system.architecture.json
  - apps/ui-workbench/**
  - apps/extension/**
  - packages/ui/**
  - packages/domain/**
  - packages/application/**
  - packages/contracts/**
  - packages/adapters-*/**
  - packages/adapters-indexeddb/**
  - package.json
  - package-lock.json
review: on-change
revised: true
---

# ADR-0029 — Component and module boundaries

- Status: accepted
- Date: 2026-09-03
- Revised: 2026-09-06

## Context

Tobirink needs extension surfaces, reusable components, local persistence and
replaceable providers without duplicating behavior between the popup, pages
and development tools. A visual catalogue is useful only if it
renders the exact components shipped by the product and does not become a
second component system.

## Decision

Keep product dependencies directed inward:

- `packages/domain` contains framework-free entities, values and invariants.
- `packages/application` contains use cases, owned ports and contracts. It may
  depend on the domain, never on React, WXT, Dexie or provider SDKs.
- Application recovery validates serialized import envelopes with the selected
  Zod boundary library before invoking an atomic replacement port.
- `packages/contracts` contains provider-neutral fakes and reusable adapter
  contract suites. It may depend inward on application and domain public APIs,
  but no production package depends on it.
- Adapter packages implement application ports and contain browser, storage,
  network or provider details.
- `packages/adapters-browser` validates bookmark URLs and owns WebExtension
  notification calls; application resolution receives only normalized records.
  The package exposes its adapter contract tests through its own workspace test
  script so root and focused gates execute the same maintained suite.
- The IndexedDB adapter owns versioned Dexie migrations, local integrity
  checks, and browser-only migration fixtures. Root scripts expose these
  package checks without moving persistence behavior into the workspace root.
- Durable MV3 work uses an application-owned state machine and a Dexie task
  store; persisted leases and idempotency keys replace process-local timers.
- Root quality commands delegate typechecks and focused test suites to these
  workspaces; they are orchestration entry points, not a shared runtime layer.
- `packages/ui` contains tokens, primitives and domain components. Components
  receive serializable state and callbacks; they do not call IndexedDB,
  browser APIs or cloud providers directly.
- `apps/extension` composes application use cases, adapters and shared UI into
  popup, library, Review, agenda and settings surfaces.
- `apps/ui-workbench` is a local development adapter. It imports the same
  public UI entry points as the extension and never enters its production
  dependency graph.

Organize UI reuse in three levels. Primitives express interaction without
product knowledge. Domain components compose primitives around one Tobirink
concept. Surfaces arrange domain components and connect them to use cases. A
surface may not introduce a private replacement for an existing primitive or
domain component.

Each component owns one directory containing its implementation, CSS Module,
test, `*.preview.tsx` module and `index.ts` public entry point. Cross-directory
imports use public entry points; deep imports into another component are
forbidden. Internal helpers stay private until two real consumers justify a
shared module.

A preview exports typed metadata, synthetic fixtures and a render function.
The metadata identifies the component, category, purpose, variants, states,
source files, dependencies, accessibility checks and usage example. Vite
discovers previews with `import.meta.glob`; contributors never maintain a
second registry by hand.

Preview metadata also declares whether the rendered subject is a `component`,
`page` or `popup`. This value configures only the development canvas: pages use
the available width without a simulated container, popups retain their bounded
surface with scrollable overflow, and components keep the isolated inspection
frame. The Workbench owns its Auto/390/768 simulation and URL-fragment routing;
product components remain unaware of both.

The workbench renders only its catalogue and preview canvas. It discovers
preview modules with `import.meta.glob`, but bundles neither raw project source
files nor a source-code editor. A planned catalogue entry may be shown before
implementation, but a discovered preview becomes the sole source for an
implemented component.

## Consequences

The popup, pages and workbench share behavior instead of copying
markup. Provider replacement stays outside domain and UI code. Adding a
component requires a small but complete unit of implementation, styling,
preview and evidence. Moving a private helper into shared UI requires observed
reuse rather than speculative abstraction.

The UI architecture source represents these boundaries without Monaco or a raw
source index and passes showcase validation.
