---
scope:
  - docs/architecture/platform-connectors.md
  - docs/architecture/README.md
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/theme-interactions.md
  - docs/architecture/src/platform-connectors.architecture.json
  - docs/pocs/macos-connector-poc2.md
  - docs/pocs/macos-surface.md
  - docs/pocs/macos-native-wallpaper.md
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/03-product-roadmap.md
  - docs/document-contracts.json
  - docs/README.md
  - docs/session-handoff.md
  - .project/project-config.json
review: on-change
---
# ADR-0049 — Connecteurs OS séparés et nouveau PoC macOS

- Status: accepted
- Date: 2026-09-08

## Context

Le premier PoC macOS a établi plusieurs faits utiles : un provider wallpaper natif
peut rendre le décor et des objets animés ; un compagnon peut transmettre des commandes
et projeter un hit-test ; TCC, Finder, Spaces et le cycle de vie du provider imposent
des responsabilités natives. L'itération a toutefois accumulé deux manifests, deux
représentations de panneau, des modes historiques et plusieurs chemins de lancement.

Les wallpapers et créations doivent rester communs à tous les systèmes, mais leur
intégration ne peut pas être portée par une unique implémentation de fenêtre. Les
primitives et garanties de Windows, macOS, Wayland, GNOME et X11 diffèrent.

## Decision

1. Geler le PoC macOS 1 comme preuve historique ; ne plus l'étendre comme base produit.
2. Définir un contrat de thème et un cœur sémantique portables, sans types OS ou moteur.
3. Implémenter un connecteur distinct par famille d'environnement : macOS, Windows,
   Wayland layer-shell, GNOME Wayland et X11.
4. Laisser chaque connecteur annoncer ses capacités réelles et ses fallbacks ; aucune
   promesse globale « tous OS » ne précède leur qualification séparée.
5. Lancer un PoC macOS 2 isolé en Swift/AppKit avec un manifeste canonique, une seule
   surface de contrôle et une interface de transport corrélée.
6. Ne pas introduire Rust/wgpu, terminal, ROM, IA ou convertisseur dans cette preuve.
7. Réutiliser du PoC1 uniquement les éléments évalués un par un ; ne pas copier son
   architecture, ses deux manifests, ses panneaux ou son transport diagnostic en bloc.
8. Considérer l'interface Apple wallpaper utilisée comme privée et expérimentale tant
   que distribution, stabilité et cycle de vie ne sont pas qualifiés.

## Consequences

Une création est écrite une fois, puis activée selon un contrat de capacités. Le code
natif est plus nettement séparé et peut évoluer au rythme de chaque OS sans contaminer
les packages de thèmes.

Le coût assumé est l'existence de plusieurs connecteurs et matrices de tests. Ce coût
correspond à la réalité des plateformes et remplace les branches conditionnelles
cachées dans un faux adaptateur universel.

Le deuxième PoC recommence une implémentation bornée au lieu de nettoyer implicitement
la sonde pendant le développement. La preuve existante reste reproductible et aucun
fichier historique n'est supprimé.
