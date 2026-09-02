# UI design contract

The blueprint provides a framework-neutral UI contract. It does not select a
frontend framework, component library, CSS strategy, or rendering runtime.

## Purpose

The contract gives an agent a reusable vocabulary before it creates product UI.
It defines design tokens, component roles, variants, states, slots,
accessibility evidence, and composition rules. A derived product maps these
abstract components to its chosen framework after that choice is explicit.

## Rules

- Reuse an existing contract component before creating a new one.
- Use named design tokens instead of arbitrary color, spacing, typography, or
  motion values.
- Keep structure, behavior, and styling in their appropriate product layers.
- Document a custom component with a rationale and its accessibility evidence.
- Treat the contract as guidance and a validation target; it does not mutate
  product code or choose a framework automatically.

## Validation

The machine-readable source is [`.project/ui-design-contract.json`](../.project/ui-design-contract.json).
Run `npm run validate:ui` to validate its schema, token references, component
identifiers, required states, and framework-neutral policy.

The contract requires evidence for component usage, token usage, and an
accessibility review. A product-specific adapter may enforce those fields in a
framework-aware way later; this blueprint validator intentionally does not
pretend to parse every frontend ecosystem.

## Blueprint tooling adapter

The local Progress dashboard reuses the action, field, surface, and dialog
roles without changing the product framework policy. Its machine-readable
`toolingEvidence.progressDashboard` entry records the token and accessibility
mapping. Native buttons, checkbox, details, dialog, form, headings, and live
status preserve keyboard and assistive-technology behavior; responsive CSS
collapses the content grid to one column. Plan approval and execution-mode
changes use an explicit confirmation step.
