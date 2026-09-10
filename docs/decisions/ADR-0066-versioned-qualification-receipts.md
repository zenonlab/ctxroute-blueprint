---
scope:
  - pocs/theme-behavior-kernel/
  - docs/02-quality-strategy.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
review: on-change
revised: true
---
# ADR-0066 — Reçus de qualification liés aux entrées

- Status: accepted
- Date: 2026-09-10

## Context

Une capture ou une moyenne isolée ne permet pas de retrouver la recette, le binaire
et les ressources privées réellement mesurés. Les compteurs indisponibles ne doivent
pas être remplacés par zéro, qui serait interprété à tort comme une observation.

## Decision

Chaque preuve M0–M6 utilise un reçu JSON versionné. M0 lie SHA-256 de la recette,
du binaire et, lorsqu'il est fourni, de l'arbre privé d'assets. Huit ticks strictement
croissants, dont le tick zéro, produisent huit empreintes de snapshot.

Un compteur non instrumenté est `null`. Les reçus matériels ultérieurs ajouteront
machine, OS, écran, scénario, répétitions, package et incertitude sans modifier le
sens du reçu M0. Les sorties ne peuvent être écrites que sous `private/` ou `dist/`.

## Consequences

Le noyau peut prouver son déterminisme sans GPU et sans contenu commercial. Il ne
prétend pas mesurer les soumissions GPU, allocations du renderer ou joules ; ces
champs restent absents de l'observation jusqu'au harnais M6.

## Implementation evidence

`pocs/theme-behavior-kernel` valide la recette, capture huit états reproductibles,
compte pas, rattrapages, pauses et transitions d'occlusion, puis produit le reçu.
Les tests comparent deux exécutions et vérifient l'arrêt sous occlusion.
