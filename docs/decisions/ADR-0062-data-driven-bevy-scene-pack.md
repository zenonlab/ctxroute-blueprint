---
scope:
  - pocs/game-theme-viewer/
  - docs/architecture/game-transformation.md
  - docs/pocs/theme-design-poc.md
  - docs/02-quality-strategy.md
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0062 — Piloter la scène Bevy par un pack multi-instance

- Status: accepted
- Date: 2026-09-09

## Context

Le premier manifeste du visualiseur ne décrivait qu'un GLB et une caméra. Il ne
pouvait ni instancier des personnages séparés, ni choisir leurs clips, ni préserver
les transformations et identités nécessaires aux futures associations de sessions.
Ajouter ces connaissances directement dans le code Bevy rendrait le runtime propre
à Majora's Mask et contredirait la frontière du compilateur de thème.

## Decision

Le pack de preuve décrit un catalogue d'assets locaux, une liste d'instances
identifiées, leur transformation, un clip optionnel et une caméra. Chaque référence
est validée avant l'initialisation graphique. Bevy charge uniquement ce contrat : il
ne connaît ni ROM, ni console, ni Fast64, ni nom de scène ou d'acteur Zelda64.

Le compilateur hors ligne est responsable de résoudre les relations privées,
d'exporter les dérivés et de renseigner leur qualification. Un asset visuel
`approximated` reste affichable pour diagnostiquer la chaîne, mais ne ferme pas le
gate de fidélité. Une animation déclarée sans clip présent doit échouer visiblement,
jamais être remplacée silencieusement par un mouvement procédural.

Chaque asset déclare aussi son profil sémantique, son profil de rendu effectif et sa
qualification visuelle. [ADR-0063](ADR-0063-source-render-profiles-and-oracles.md)
définit leur validation et supersède toute lecture de glTF comme preuve implicite de
fidélité au moteur source.

La fenêtre Bevy reste le premier hôte de validation. Le même modèle de scène et la
même séquence d'événements devront ensuite être rendus dans la `CAMetalLayer` du
provider macOS pour fermer D1-19 ; aucune capture de fenêtre n'est une substitution.

## Consequences

Le PoC peut ajouter décor, personnages et objets sans modifier le renderer. Les
identités d'instances deviennent la future frontière de picking, de personnalisation
et d'association aux sessions. Le travail spécifique à un jeu reste dans l'adaptateur
et dans les données privées du pack.
