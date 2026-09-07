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

[`src/active-page-progress.dataflow.json`](src/active-page-progress.dataflow.json)
documents the runtime data path from the voluntarily exposed active tab through
local identity correlation, the monotonic progress guard, IndexedDB and the
reconstructible continuation cache to the popup WorkCard.

[`src/favorite-resolution.dataflow.json`](src/favorite-resolution.dataflow.json)
documents the lossless path from browser favorites through URL evidence,
versioned parsing, durable MV3 tasks and deterministic provider matching to
Review or the authoritative private IndexedDB records. Its bounded convergence
view accompanies the implementation contract in
[`favorite-resolution-rebuild-pipeline.md`](../systems/favorite-resolution-rebuild-pipeline.md):
inventory slices, checkpoints, additive migration and exact-ID hydration are
delivered without moving private authority out of IndexedDB.

[`src/extension-delivery-validation.dataflow.json`](src/extension-delivery-validation.dataflow.json)
maps the delivery evidence from the shared extension sources through automated
contracts, browser builds and reproducible packages to the release gate. It
keeps the remaining interactive Chrome and Firefox checks explicit instead of
presenting an incomplete browser pass as a finished delivery.

[`src/production-publication.dataflow.json`](src/production-publication.dataflow.json)
records the approved production path from the static export and two versioned
archives through the exact allowlist to the public Worker and R2 bucket, then
to the HTTP and SHA-256 verification evidence observed on `tobirink.com`.

[`src/production-surface.architecture.json`](src/production-surface.architecture.json)
shows the deployed ownership boundaries: private member state remains local to
the extension, while the public Worker owns the static surface and reads only
public catalogue, media and versioned release resources.

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

Validate one product diagram with `npm run archify:validate -- tobirink`,
`npm run archify:validate -- ui-system` or `npm run archify:validate -- dataflow`,
and validate all product diagrams with
`npm run archify:validate -- all`.
Generate the interactive HTML with `npm run build:docs`; output stays under
ignored `dist/` and must never be edited manually or committed.

Run `npm run archify:visual-check -- tobirink` only after a successful build. It measures
containment at 1440×900, 1600×1000, 1920×1080, and 2048×1320 and generates
light/dark captures, a contact sheet, and a JSON receipt when product diagrams
exist. Automated evidence keeps `visualReview: pending` until the owner inspects
and approves the artifact.
