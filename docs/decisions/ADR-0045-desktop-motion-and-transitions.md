---
scope:
  - pocs/macos-surface/**
  - docs/pocs/macos-surface.md
  - docs/architecture/src/macos-surface-poc.architecture.json
review: on-change
---
# ADR-0045 — Animation indépendante des clics et surface conservée

- Status: accepted
- Date: 2026-09-07

## Context

Le mode bureau était statique par construction. L'utilisateur demande animation,
commandes et continuité lors de sorties/retours, sans avoir précisé le type de
transition. Aucun jeu ni asset n'est chargé : ne pas attribuer les blancs à un
temps de chargement sans preuve.

## Decision

L'animation démarre en bureau indépendamment de la réception des clics. La surface
reste sous Finder et ignore la souris. Un menu de barre macOS permet explicitement
pause, halo, arrêt d'animation et fermeture. Ce repli ne constitue pas une preuve
de clic sur la géométrie du wallpaper. Il précise ADR-0043/0044 : le fond reste
passif aux entrées, mais n'est plus nécessairement statique.

Conserver une même fenêtre, un même état et une couche backing entre transitions.
Observer Spaces, veille écran et activation de session via NSWorkspace ; restaurer
l'ordre de la même surface au retour, sans reconstruire les ressources.
Ne pas monter au-dessus des applications ni injecter le fond dans leur plein écran.

Si l'occlusion AppKit n'annonce pas la visibilité, autoriser seulement le repli
explicite « Finder au premier plan + fenêtre sur Space actif et ordonnée ». Ce
signal n'est pas une preuve d'absence d'occlusion : une fenêtre Finder peut couvrir
le bureau. Consigner source brute et décision de pacing séparément. Veille, session
inactive, pause et réduction des animations gardent priorité. Aucun polling rapide
des fenêtres tierces ; cadence demandée 30 Hz maximum, pas de timer au repos.

## Consequences

Tests unitaires sur droits d'animation, repli et suspension. Les notifications
synthétiques éprouvent les handlers, pas les animations du compositeur. Tester
Spaces, plein écran et Mission Control séparément avant toute promesse de continuité.
Pas de hook souris, d'accessibilité globale ou de modification du fond système.

Sources : [Apple — Space actif](https://developer.apple.com/documentation/appkit/nswindow/isonactivespace),
[notifications NSWorkspace](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification).
