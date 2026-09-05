# UI design contract

The machine-readable contract remains framework-neutral. Tobirink implements it
through React 19 components and CSS Modules inside WXT entrypoints; this adapter
choice does not introduce React, WXT, or CSS concerns into application or
domain packages.

## Purpose

The contract gives contributors a reusable vocabulary before they create UI.
It defines design tokens, component roles, variants, states, slots,
accessibility evidence, and composition rules. The Tobirink React adapter maps
these abstract roles to extension components and preserves the same state and
accessibility requirements across the popup, product pages, and options view.

## Rules

- Reuse an existing contract component before creating a new one.
- Use named design tokens instead of arbitrary color, spacing, typography, or
  motion values.
- Keep structure, behavior, and styling in their appropriate product layers.
- Document a custom component with a rationale and its accessibility evidence.
- Keep React and WXT imports in UI and delivery adapters; components call
  application use cases rather than storage, browser, or cloud providers.
- Treat the contract as guidance and a validation target; framework-aware
  enforcement is added only with the approved UI implementation.

## Component boundaries

The React adapter has three reuse levels:

1. Primitives implement generic interaction and contain no Tobirink domain
   vocabulary.
2. Domain components compose primitives around one product concept and expose
   state plus events through props.
3. Extension surfaces compose domain components and connect them to application
   use cases.

Each component is an autonomous directory with an `index.ts` public entry
point, implementation, CSS Module, test and adjacent `*.preview.tsx`. Consumers
import the public entry point and never reach into another component's private
files. Shared UI does not import storage, WebExtension or cloud adapters.

## Preview contract

A preview declares a stable identifier, title, category, purpose, variants,
states, presentation (`component`, `page` or `popup`), synthetic fixtures,
source files, dependencies, accessibility checks, usage example and render
function. It imports the component through its public entry point. The
Workbench applies presentation only to its own canvas: components keep the
isolated frame, pages use the available width without a decorative frame, and
popups retain their bounded format with horizontal scrolling when a simulated
viewport is narrower than the surface.

The local workbench discovers these modules at build time with
`import.meta.glob` and renders their declared previews. It does not bundle a
source-code editor or raw project files. The workbench has no arbitrary
filesystem access and remains outside the extension production bundle. Its
Auto, 390 and 768 controls change the rendered width, and the selected preview
identifier is reflected in the URL fragment for stable direct links.

An implemented component has one discovered preview as its catalogue source.
Planned entries may remain visible before implementation, but no handwritten
registry duplicates implemented preview metadata.

## Validation

The machine-readable source is [`.project/ui-design-contract.json`](../.project/ui-design-contract.json).
Run `npm run validate:ui` to validate its schema, token references, component
identifiers, required states, and framework-neutral policy.

The contract requires evidence for component usage, token usage, public API
usage, preview coverage, and an accessibility review. The current validator
checks the neutral schema. The approved React adapter gate will add component,
preview, import-boundary, browser-interaction and accessibility evidence without
changing the neutral vocabulary.
