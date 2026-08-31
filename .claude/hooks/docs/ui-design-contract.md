---
match: ["src/", "app/", "components/", "ui/", "pages/"]
mode: smart
threshold: 4
---
# UI design contract

Before adding or changing product UI, consult `.project/ui-design-contract.json`
and `docs/ui-design-contract.md`.

Reuse the closest declared component role before creating a custom component.
Use named design tokens, preserve explicit interaction states, and record the
accessibility evidence required by the contract. The blueprint does not select
a frontend framework; apply the contract through the derived product's chosen
adapter.
