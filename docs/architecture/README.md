# Architecture

Typed Archify product diagrams under `docs/architecture/src/` are the versioned
source of truth. The agent chooses the type that describes the product result:
`architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle`.
Every product source is declared explicitly in `architecture.documents`; an
undeclared source fails validation instead of becoming public implicitly.

The blueprint control-plane sources are declared in
`architecture.internalDocuments`. They are maintainer-only validation inputs:
the product registry, preview, `build:docs`, `visual-check`, and selector `all`
exclude them. A product diagram must never contain CTXRoute, Progress MCP, CRG,
Sensor, Archify, hook, or other blueprint implementation components.

Validate all product diagrams with `npm run archify:validate -- all`, or select
one by filename stem or type, for example `npm run archify:validate -- dataflow`.
Generate the interactive HTML with `npm run build:docs`; output stays under
ignored `dist/` and must never be edited manually or committed.

Run `npm run archify:visual-check` only after a successful product build. It
checks all delivered product diagrams by default; pass a product selector to
inspect one.
It measures
containment at 1440×900, 1600×1000, 1920×1080, and 2048×1320 and generates
light/dark captures, a contact sheet, and a JSON receipt when product diagrams
exist. Automated evidence
keeps `visualReview: pending` until a human inspects the artifact.
