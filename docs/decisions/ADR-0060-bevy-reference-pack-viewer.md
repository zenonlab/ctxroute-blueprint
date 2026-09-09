---
scope:
  - .project/project-config.json
  - pocs/game-theme-viewer/
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/pocs/theme-design-poc.md
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0060 — Éprouver Bevy avec un pack de thème générique

- Status: accepted
- Date: 2026-09-09

## Context

Le pont visuel Majora's Mask produit un GLB privé, mais le renderer ne doit dépendre
ni du jeu, ni de Fast64, ni de Blender. La preuve suivante doit isoler le chargement
et la présentation avant le raccord à la surface wallpaper macOS.

## Decision

Créer un visualiseur de référence Bevy 0.19.1 qui reçoit uniquement un répertoire de
pack. Le manifeste versionné décrit une scène glTF/GLB, une caméra et des capacités
qualifiées. Tous les chemins d'assets sont relatifs au pack, sans traversée, et leur
existence est vérifiée avant l'initialisation graphique.

Le visualiseur utilise `WinitSettings::desktop_app()` et ne contient aucune animation
continue. L'orbite et le zoom sont déclenchés par l'entrée. Cette fenêtre sert à
valider le pack et le backend ; elle ne valide pas encore `RenderHost`, la
`CAMetalLayer` du provider, le picking diégétique ou l'énergie.

## Consequences

Le même exécutable peut ouvrir un pack issu de n'importe quel adaptateur capable de
produire le contrat commun. Le pack reste minimal pour cette preuve ; comportements,
ancres, audio et UI seront ajoutés par versions compatibles, avec tests de contrat.

Un succès en fenêtre ordinaire ferme seulement la première moitié de D1-19. Le
raccord à la surface macOS et les mesures répétées restent obligatoires.
