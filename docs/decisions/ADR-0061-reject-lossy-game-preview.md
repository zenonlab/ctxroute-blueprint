---
scope:
  - pocs/game-theme-viewer/
  - pocs/macos-connector/
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/pocs/game-library-g1-results.md
  - docs/pocs/theme-design-poc.md
  - docs/pocs/macos-connector-poc2.md
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0061 — Rejeter le preview GLB avec matériaux devinés

- Status: accepted
- Date: 2026-09-09
- Supersedes: ADR-0060 pour la qualification visuelle du pack Majora's Mask

## Context

Le visualiseur Bevy a prouvé le chargement d'un pack générique dans une fenêtre,
mais sa ressource privée associait arbitrairement une texture `Tex0_*` à chaque
matériau Fast64. Le résultat visible perd les deux textures, combineurs, palettes,
paramètres de tuile et modes alpha du pipeline N64. Une fenêtre winit ordinaire ne
prouve par ailleurs aucune exécution dans le provider wallpaper macOS.

## Decision

Conserver le visualiseur uniquement comme harnais générique de chargement glTF et
rejeter le GLB Majora's Mask actuel comme preuve de fidélité. Aucun export ne passe
le gate visuel tant qu'il ne provient pas d'un interpréteur F3DEX2 qualifié ou d'un
bake déterministe du graphe de matériau qualifié, comparé à un oracle de référence.

Ajouter au manifeste macOS expérimental un nom de PNG local borné. Le build peut
injecter explicitement ce rendu privé par `CONNECTOR_LOCAL_BACKGROUND_PATH`; aucun
asset n'entre dans Git. Le provider le compose dans son propre arbre `CAContext`,
derrière les contrôles existants. Cette tranche prouve uniquement le raccord d'un
asset du jeu au vrai wallpaper. Elle ne prétend pas être de la 3D temps réel.

## Consequences

Les résultats du viewer ne peuvent plus être décrits comme un pack visuellement
validé. La prochaine preuve graphique temps réel doit viser directement un
`CAMetalLayer` possédé par le provider, sans fenêtre de substitution. Le chemin PNG
reste un témoin transitoire et remplaçable, pas l'architecture finale de rendu.
