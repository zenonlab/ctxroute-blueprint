---
scope:
  - pocs/macos-surface/**
  - docs/pocs/macos-surface.md
  - docs/architecture/src/macos-surface-poc.architecture.json
review: on-change
---
# ADR-0044 — Lancement macOS du fond de bureau

- Status: accepted
- Date: 2026-09-07

## Context

Une fenêtre de diagnostic ne démontre pas un wallpaper. Le lancement du binaire
brut signale une fenêtre ordonnée mais invisible au sens de l'occlusion AppKit.
Le contrôle GUI ne reconnaît pas cet exécutable comme application.

## Decision

Ajouter une commande `desktop` dédiée qui construit une application `.app` locale
dans un répertoire temporaire unique sous `dist/pocs/macos-surface/`. LaunchServices
la lance en arrière-plan via `open -g -n -W`, avec durée finie et mode bureau passif.
Le mode `run` conserve son comportement de diagnostic. Aucun installateur,
autostart ou changement des préférences de fond système.

La surface utilise `orderFrontRegardless` au niveau desktop + 1, sous desktopIcon,
sans devenir clé ni accepter la souris. Ce placement est une hypothèse à éprouver,
pas une qualification Finder/Spaces. Les dimensions et états de fenêtre figurent
au reçu ; aucune capture ni métadonnée d'une fenêtre tierce dans le runtime.

## Consequences

Le bundle de développement n'est ni signé pour distribution ni notarié. Il ne
contourne aucune autorisation système. Les reçus stdout/stderr sont enregistrés
dans son dossier de lancement unique. La fin de `open -W` ne prouve pas le succès
fonctionnel : lire le reçu de l'application. Aucun nettoyage automatique.

Source : [Apple, orderFrontRegardless](https://developer.apple.com/documentation/appkit/nswindow/orderfrontregardless()).
La méthode modifie l'ordre dans le niveau de fenêtre sans changer la fenêtre clé.
