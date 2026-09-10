---
scope:
  - tools/game-library/
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0067 — Adaptateur de course Mario Kart Wii hors ligne

- Status: accepted
- Date: 2026-09-10

## Context

La deuxième course imposée est `farm_course.szs`. Aucun asset Nintendo ne peut être
commité et le runtime ne doit charger ni émulateur ni convertisseur.

## Decision

Le convertisseur local accepte les conteneurs Yaz0/U8, applique des limites de taille
et de cardinalité, refuse les chemins dangereux et écrit uniquement sous `private/`.
Il classe les formats de circuit, KCL, KMP, textures, animations, UI, audio, effets
et dépendances sans introduire de règle propre à une course dans le runtime.

L'archive privée absente est un prérequis explicite : le test libre construit une
petite archive U8 originale et prouve seulement l'adaptateur générique.

## Consequences

Deux courses peuvent partager le même pipeline par changement d'entrée et de recette.
La conversion réelle de `farm_course.szs`, sa fermeture de dépendances et sa fidélité
restent non acquises tant que l'archive privée n'est pas fournie au gate local.
