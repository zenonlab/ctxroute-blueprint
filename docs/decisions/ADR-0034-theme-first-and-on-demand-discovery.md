---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/architecture/runtime-infrastructure.md
  - docs/research/console-coverage.md
  - docs/session-handoff.md
  - docs/architecture/README.md
  - README.md
review: on-change
---
# ADR-0034 — Thèmes d'abord, découverte des outils à la demande

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur recentre le produit sur la création de thèmes pour wallpapers et
terminaux custom. Il ne souhaite pas maintenir un inventaire exhaustif de jeux :
l'IA doit pouvoir rechercher les outils nécessaires puis aider à préparer les
dépendances d'un thème à la demande. Les langages et technologies viennent après.

## Decision

Le livrable principal est un package de thème : notre logique, nos créations,
paramètres et références. Les données et la logique originale extraites du jeu
restent des dépendances locales distinctes, sans fusion dans ce package.
Le runtime n'exige ni IA, ni convertisseur, ni émulateur permanent pour afficher
le thème ; les agents de travail lancés dans les shells sont indépendants.

L'assistance de préparation découvre les dépôts publics à la demande, inspecte
outils/licences/versions, prépare une chaîne et la valide localement sous
permissions et limites explicites. Conserver un adaptateur reproductible et
ses preuves ; ne pas refaire la découverte pour chaque activation du thème.
Pas d'envoi de ROM, assets, code extrait ou traces privées vers une IA distante.
L'absence d'outil ou de capacité est signalée sans promesse universelle.

Le catalogue existant est conservé comme recherche exploratoire, non comme
registre obligatoire à compléter. Une bibliothèque couvrant le jeu entier reste
une extension possible, pas une condition préalable à la création d'un thème.
La préservation des données effectivement récupérées reste acquise.

## Consequences

Cet ADR remplace la priorité à l'inventaire et à l'assemblage technique proposé
dans ADR-0033 ; ses frontières de responsabilités restent utiles. Il précise
ADR-0031/0032 sans annuler la séparation locale ni les capacités qualifiées.
Rust/Tauri/Godot et les autres pistes restent des hypothèses sans préférence
figée. Aucun langage, fournisseur IA, sandbox ou format de package n'est adopté.

Prochaine étape : comparer l'existant pour créer, installer et activer un thème
wallpaper/terminal, puis choisir la stack et les preuves minimales. Un thème
original sans ROM peut servir à cette comparaison. Aucun produit implémenté.
