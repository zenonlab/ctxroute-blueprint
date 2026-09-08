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
revised: true
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

Correctif de revue : la construction ad hoc ne qualifie pas l'accès App Group.
Sans Team ID, le transport partagé est explicitement indisponible, sans tentative
de contournement. Une identité présente ne vaut pas preuve d'accès du provider.
Les mailboxes de tests n'émettent aucune notification Darwin par défaut ; seul
`shared()` active les signaux système. Chaque session conserve sa dernière quittance
30 secondes afin qu'une publication de cycle de surface ne l'efface pas.
Installation et lancement refusent les compagnons historiques encore actifs ;
un provider historique chargé est signalé comme conflit, jamais arrêté implicitement.

Complément multithème : le catalogue énumère des manifestes embarqués, validés et
uniquement locaux. Une session d'état est isolée par `theme_id` ; une surface
WallpaperID garde son CAContext et remplace son arbre lors d'un changement de choix.
Le fichier d'état contient une enveloppe versionnée `themes`, pas un état global
qui serait modifié par un aperçu d'un autre thème. L'app choisit le thème à contrôler ;
seuls les Réglages macOS déterminent le wallpaper affecté à un écran/Space.
Le build doit vérifier le décodage du catalogue par les vraies classes Apple avant
installation ; les champs requis privés ne sont pas déduits des seuls shims Swift.

Une seule fenêtre de contrôles dans l'app ; aucun panneau copié dans le wallpaper.
Le renderer est passif. Visibilité Finder et entrée globale restent indisponibles
tant que leurs preuves natives manquent ; l'app fournit le chemin vers les réglages.
Ne pas déclarer un toggle effectif lorsque seule une préférence interne est lisible.

## Consequences

La preuve peut être construite et testée sans installer de framework ni moteur 3D.
Les signatures ad hoc et le transport App Group doivent être éprouvés localement.
La qualification des gestes, Spaces et énergie reste distincte des tests unitaires.
L'installation utilise une nouvelle identité, sans supprimer ni remplacer le PoC1.
