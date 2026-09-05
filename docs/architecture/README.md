# Architecture

[`src/tobirink.architecture.json`](src/tobirink.architecture.json) is the
versioned product source of truth. It shows a local-first domain and application
core surrounded by replaceable UI, browser, storage, and cloud adapters.
IndexedDB is the sole private authority. Browser bookmarks import data and may
receive an optional projection; browser sync holds only a bounded non-secret
recovery envelope.

Dependencies point inward. Domain code has no framework or provider imports.
Application use cases depend on owned ports. WXT, React, Dexie, WebExtension
APIs, Hono, Cloudflare Workers, and D1 live at the outer edge.
The optional cloud boundary keeps normalized public catalogue rows in D1,
immutable rights-approved masters and encrypted backup blobs in R2, and only
three fixed resize/quantization variants behind the image gateway.

[`src/ui-system.architecture.json`](src/ui-system.architecture.json) refines the
UI boundary. Shared product components feed the extension surfaces, while an
independent local workbench discovers adjacent `*.preview.tsx` modules, renders
their declared states, and keeps its viewport limited to the catalogue and
preview canvas. It bundles neither Monaco nor raw project sources and never
enters the production extension bundle.

The extension build uses a dedicated WXT entrypoint directory so its generated
Manifest V3 shell remains separate from reusable React surfaces and previews.
The generated manifest carries only documented browser permissions, local-only
script policy, and a background router that validates every message before
dispatch.

The blueprint control-plane sources are declared in
`architecture.internalDocuments`. They are maintainer-only validation inputs:
the product registry, preview, `build:docs`, `visual-check`, and selector `all`
exclude them. A product diagram must never contain CTXRoute, Progress MCP, CRG,
Sensor, Archify, hook, or other blueprint implementation components.

Validate one product diagram with `npm run archify:validate -- tobirink` or
`npm run archify:validate -- ui-system`, and validate all product diagrams with
`npm run archify:validate -- all`.
Generate the interactive HTML with `npm run build:docs`; output stays under
ignored `dist/` and must never be edited manually or committed.

Run `npm run archify:visual-check -- tobirink` only after a successful build. It measures
containment at 1440×900, 1600×1000, 1920×1080, and 2048×1320 and generates
light/dark captures, a contact sheet, and a JSON receipt when product diagrams
exist. Automated evidence keeps `visualReview: pending` until the owner inspects
and approves the artifact.
