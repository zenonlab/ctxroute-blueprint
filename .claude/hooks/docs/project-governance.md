---
match: ["package.json", ".project/", "src/", "app/", "lib/"]
mode: once
---
# Project governance

Before changing project structure, read `AGENTS.md`, relevant ADRs, and only
the product Archify sources listed in `.project/project-config.json` under
`architecture.documents`. Entries in `architecture.internalDocuments` describe
blueprint infrastructure and never count as product evidence. Add or update a
product source only for a material boundary, dependency, contract, or
cross-component flow.
