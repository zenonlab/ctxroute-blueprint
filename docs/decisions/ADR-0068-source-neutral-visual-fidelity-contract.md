---
scope:
  - pocs/game-theme-viewer/
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0068 — Contrat de fidélité visuelle source-neutre

- Status: accepted
- Date: 2026-09-10

## Decision

Le manifeste v3 conserve les tables source consultées et traduit pilote, bras,
roues, braquage, alpha, culling, LOD, ombres et ciel en rôles génériques. Toute
approximation est une donnée bornée du manifeste et interdit le statut `qualified`.
Bevy reste un adaptateur `gltf.standard`; il ne reçoit aucun identifiant Nintendo.

## Consequences

Les tables `kartPartsDispParam`, `kartDriverDispParam`, `driverDispParam` et BSP
peuvent être citées comme provenance privée, mais seules leurs sorties sémantiques
atteignent le viewer. Sans pack Mario Kart privé et vues oracle, M2 reste un contrat
testable, pas une preuve de fidélité obtenue.
