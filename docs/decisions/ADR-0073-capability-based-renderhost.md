---
scope:
  - pocs/macos-connector/**
  - docs/architecture/src/macos-renderhost.sequence.json
review: on-change
revised: true
---
# ADR-0073 — Résoudre le RenderHost par capacité locale

## Décision

Un package de thème déclare un identifiant de capacité `renderer`, jamais une commande ni un exécutable.

Le connecteur Swift associe localement cet identifiant à un fichier exécutable approuvé par l’utilisateur.

Il lance directement le RenderHost avec la recette validée et l’argument typé `--desktop`, sans shell.

Un seul processus RenderHost appartient au connecteur ; une nouvelle activation arrête uniquement ce processus enfant.
Si ce processus se termine de façon inattendue après son démarrage, le contrôleur invalide
atomiquement l'identité active et publie un événement de terminaison sur l'acteur principal.
Le provider peut ainsi afficher l'état d'erreur ou proposer une reconnexion sans lancer de
redémarrage automatique non borné.

## Conséquences

Ajouter un thème compatible ne modifie pas le connecteur.

Les chemins privés et les assets restent hors Git.

Le mode desktop dépend d’un adaptateur macOS qualifié dans le RenderHost ; les autres plateformes conservent le viewer commun.
