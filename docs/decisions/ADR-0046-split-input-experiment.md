---
scope:
  - pocs/macos-surface/**
  - docs/pocs/macos-surface.md
  - docs/architecture/src/macos-surface-poc.architecture.json
  - .project/project-config.json
review: on-change
---
# ADR-0046 — Essai explicite de couche interactive distincte

- Status: accepted
- Date: 2026-09-07

## Context

Le PoC précédent ne répond pas aux clics du décor. La recherche dans
[Übersicht — UBWindowGroup](https://github.com/felixhageloh/uebersicht/blob/master/Uebersicht/UBWindowGroup.m)
et [UBWindow](https://github.com/felixhageloh/uebersicht/blob/master/Uebersicht/UBWindow.m)
montre un fond au niveau desktop et une couche interactive au niveau normal − 1.
Cette dernière se trouve au-dessus des icônes, pas derrière elles. Aucun code GPL
du projet n'est copié : expérience AppKit indépendante, sans WebView.

## Decision

Ajouter `--split-input`, réservé au mode desktop et désactivé par défaut.
Conserver le fond passif ; créer une petite NSPanel non activante à normal − 1,
limitée à un objet fixe, avec panneau de commandes séparé ouvert sur clic.
Accepter le premier clic sans rendre la fenêtre principale active. Réutiliser le
même état pour animation, effet et panneau. Compter séparément les mouseDown reçus
et les actions programmatiques du smoke. Ne pas transformer un test synthétique
en preuve de routage Finder.

Ce mode est un test de widgets, NON une validation du contrat produit : une icône
superposée à ses fenêtres n'a pas la priorité. Pas de hook global, lecture AX du
Finder, remplacement de fichiers système, API privée ou démarrage automatique.
Les fenêtres ordinaires au niveau normal restent au-dessus de la couche d'essai.

[Wallnetic — SystemWallpaperSync](https://github.com/fatihkan/wallnetic/blob/main/src/Wallnetic/Services/SystemWallpaperSync.swift)
utilise une image fixe comme fond système pour les transitions. Ici, exporter
seulement notre vue via `--export-still` dans le dossier de lancement ; ne pas
appliquer cette image sans accord distinct. Une image fixe ne conserve ni mouvement
ni interactions pendant Mission Control. Sa génération seule ne corrige aucun blanc.

## Consequences

Critères : premier clic réel → panneau ; commandes → changement visible ; fenêtre
de travail non activée par nos contrôles ; mesure distincte des transitions réelles.
Superposition d'icône : limitation connue, interdit de déclarer le mode conforme.
Le mode passif antérieur reste disponible. Aucun choix de moteur 3D ou terminal.
