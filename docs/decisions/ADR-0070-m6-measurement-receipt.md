---
scope:
  - pocs/theme-behavior-kernel/
  - docs/02-quality-strategy.md
  - docs/pocs/m6-measurement-preflight.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
review: on-change
---
# ADR-0070 — Reçu M6 strict sans métriques fabriquées

- Status: accepted
- Date: 2026-09-10

## Decision

Le reçu M6 conserve les échantillons bruts de huit scénarios, impose au moins cinq
passes alternées et calcule moyenne, médiane et écart-type par scénario. Il relie le
modèle de machine, l'OS, l'écran, le périmètre des compteurs, le package et le binaire.

Les compteurs d'énergie, CPU, GPU, wakeups, mémoire, frame time, soumissions et
latence sont optionnels au niveau de l'import, mais une absence dans un scénario
force le statut `non_conclusive`. Pause et occlusion exigent explicitement zéro
soumission GPU observée. Les reçus ne peuvent être écrits que sous `private/` ou
`dist/`.

## Consequences

Le format peut agréger un banc natif sans transformer une absence d'instrument en
résultat favorable. Il ne pilote pas lui-même Finder, Spaces, les écrans ou
`powermetrics` et ne qualifie donc aucune mesure tant que ces observations n'ont pas
été collectées sur un provider actif.
