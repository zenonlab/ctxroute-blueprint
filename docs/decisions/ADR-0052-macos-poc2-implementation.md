---
scope:
  - pocs/macos-connector/**
  - .project/project-config.json
  - docs/architecture/src/platform-connectors.architecture.json
  - docs/architecture/platform-connectors.md
  - docs/pocs/macos-connector-poc2.md
  - docs/README.md
  - docs/session-handoff.md
review: on-change
---
# ADR-0052 — Implémentation isolée du connecteur macOS 2

- Status: accepted
- Date: 2026-09-08

## Context

Le deuxième PoC doit rendre les frontières ADR-0049 à ADR-0051 exécutables sans
reprendre le panneau et les chemins de lancement accumulés dans le premier.

## Decision

Construire `pocs/macos-connector/` : modèle Foundation testé par SwiftPM, renderer
Core Animation, app AppKit et extension native compilés séparément. Le manifeste
embarqué est identique dans les deux bundles. Le provider cible macOS 26 pour cette
preuve ; le modèle pur conserve macOS 14 comme cible minimale.

Réutiliser les déclarations privées et les shims Codable de Phosphene à la révision
`8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6`, sous licence MIT conservée. Ne pas importer
le lecteur vidéo, la bibliothèque, les fonctions de récupération ou la logique du PoC1.

Éprouver un transport de fichiers atomiques bornés dans un App Group avec signal de
réveil Darwin sans payload. Le signal ne transporte ni action ni autorité. Commande,
génération, identité d'instance, état et quittance sont typés et relus ; une commande
expire et une seule est en vol. Sans accès au groupe partagé, annoncer indisponible.
Ce transport local expérimental n'est pas une adoption de production.

Une seule fenêtre de contrôles dans l'app ; aucun panneau copié dans le wallpaper.
Le renderer est passif. Visibilité Finder et entrée globale restent indisponibles
tant que leurs preuves natives manquent ; l'app fournit le chemin vers les réglages.
Ne pas déclarer un toggle effectif lorsque seule une préférence interne est lisible.

## Consequences

La preuve peut être construite et testée sans installer de framework ni moteur 3D.
Les signatures ad hoc et le transport App Group doivent être éprouvés localement.
La qualification des gestes, Spaces et énergie reste distincte des tests unitaires.
L'installation utilise une nouvelle identité, sans supprimer ni remplacer le PoC1.
