# Architecture

Product discovery: see [the conceptual product view](product-vision.md).
It documents desired capabilities only; product technologies remain undecided.

## Parcours de lecture produit

Ordre d'exécution : [feuille de route E1–E6](../03-product-roadmap.md) et
[workflow](src/product-roadmap.workflow.json), distincts du découpage des modules.

1. [Vision](product-vision.md) : expérience et sessions indépendantes des thèmes.
2. [Préparation des thèmes](game-transformation.md) : découverte IA à la demande, conversion locale et package séparé.
3. [Infrastructure](runtime-infrastructure.md) : modules, frontières, candidats et organisation cible.
   [Contrats](module-contracts.md) : propriétaires, échanges, compatibilité et preuves de remplacement.
4. [Consoles](../research/console-coverage.md) : recherche exploratoire, non inventaire à compléter.

Les schémas produit sont complémentaires ; l'infrastructure contient une proposition
de banc d'essai, pas une stack déjà installée. Les ADR portent les décisions,
les recherches portent les preuves et les documents d'architecture les contrats.

Typed Archify product diagrams under `docs/architecture/src/` are the versioned
source of truth. The agent chooses the type that describes the product result:
`architecture`, `workflow`, `sequence`, `dataflow`, or `lifecycle`.
Every product source is declared explicitly in `architecture.documents`; an
undeclared source fails validation instead of becoming public implicitly.

The blueprint control-plane sources are declared in
`architecture.internalDocuments`. They are maintainer-only validation inputs:
the product registry, preview, `build:docs`, `visual-check`, and selector `all`
exclude them. A product diagram must never contain CTXRoute, the orchestrator, CRG,
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
