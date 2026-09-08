---
scope:
  - docs/architecture/theme-customization.md
  - docs/architecture/src/theme-customization.dataflow.json
  - docs/pocs/theme-design-poc.md
  - docs/pocs/macos-connector-poc2.md
  - docs/architecture/theme-interactions.md
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/03-product-roadmap.md
  - docs/README.md
  - docs/architecture/README.md
  - docs/document-contracts.json
  - docs/session-handoff.md
  - .project/project-config.json
review: on-change
---
# ADR-0050 — Personnalisation première classe et assets locaux séparés

- Status: accepted
- Date: 2026-09-08

## Context

Le PoC macOS a prouvé une connexion au système, mais ses boutons et panneaux sont des
contrôles diagnostiques génériques. Le produit doit au contraire permettre une
composition en symbiose avec un jeu : objets 2D/3D, rigs, animations, matériaux,
icônes et menus stylisés. Les contenus commerciaux importés par l'utilisateur doivent
rester distincts de notre logique et des packages partageables.

## Decision

1. Traiter la personnalisation comme un domaine produit indépendant du connecteur OS.
2. Séparer UI native du connecteur, UI diégétique du thème et scène rendue.
3. Décrire les thèmes par identités, slots, composants sémantiques, styles, liaisons,
   capacités et provenance, sans types de renderer ou d'OS.
4. Autoriser l'import local de scènes, objets, rigs, animations, matériaux, UI, sons
   et collisions par adaptateurs hors ligne validés.
5. Conserver les assets de jeu et dérivés privés dans la bibliothèque locale ; les
   recettes partagées ne transportent que notre logique, leurs références et les
   assets redistribuables.
6. Maintenir la sémantique, le focus et l'accessibilité des contrôles même lorsque leur
   apparence est entièrement fournie par un thème.
7. Qualifier rig, retargeting et dégradation explicitement ; aucune compatibilité ne
   découle d'un nom ou d'une ressemblance.
8. Ajouter une preuve D1 originale avant de choisir définitivement le renderer.

## Consequences

Le produit peut accueillir des univers très différents sans coder chaque jeu dans le
cœur. Un auteur peut créer par code aujourd'hui et via un studio ultérieurement, car
les deux produisent le même contrat.

Le coût est un pipeline d'import, de résolution et de validation plus rigoureux. Cette
complexité est assumée hors de la boucle permanente et évite de mélanger droits,
contenus privés, rendu et intégration système.

Le PoC macOS 2 reste une preuve de connecteur. Il prépare le manifeste et les identités
mais n'est pas autorisé à choisir seul le moteur 3D ou à transformer ses boutons
diagnostiques en design final.
