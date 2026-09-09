---
scope:
  - pocs/macos-connector/**
  - docs/architecture/platform-connectors.md
  - docs/architecture/src/platform-connectors.architecture.json
  - docs/pocs/macos-connector-poc2.md
  - docs/session-handoff.md
review: on-change
---
# ADR-0057 — Suspension macOS par occlusion plein écran conservatrice

- Status: accepted
- Date: 2026-09-09

## Context

Le provider privé suspend déjà une surface lorsque WallpaperAgent publie un état
`idle` ou `locked`, et lors du sommeil de l'écran ou de la session. Sur MAC-01,
aucune mise à jour du provider n'a toutefois été observée pendant qu'une fenêtre
Chrome opaque couvrait entièrement l'écran. Une animation Core Animation peut donc
continuer hors vue. C'est incompatible avec la priorité énergétique du produit.

## Decision

L'agent macOS ajoute une classification conservatrice de la visibilité des écrans
portant les surfaces actives. Il lit uniquement la liste publique des fenêtres
actuellement composées. Un écran est qualifié `occluded` seulement lorsqu'une
application tierce fournit une couverture opaque de couche normale sur toute sa zone
de travail visible hors surfaces réservées au Dock et au menu. WindowServer peut
scinder une application en plusieurs fenêtres ; leurs rectangles sont réunis seulement
s'ils appartiennent au même PID et couvrent la zone sans trou. Une donnée absente, une
fenêtre translucide, une couverture partielle ou une géométrie ambiguë conserve l'état
visible. Les fenêtres de plusieurs applications ne sont jamais réunies.

La classification est événementielle. Elle est réévaluée lors d'une activation,
d'un changement de Space, du lancement, de la fin, du masquage ou du réaffichage d'une
application, d'un changement d'écran et après un relâchement de pointeur. Les rafales
sont coalescées ; aucun timer périodique de visibilité n'est créé.

L'agent projette ensuite `wallpaperVisible`, `wallpaperOccluded` ou
`wallpaperVisibilityUnknown` par le canal XPC corrélé existant. Cet état est distinct
de la pause choisie par l'utilisateur et de la visibilité des fichiers Finder. Le
provider suspend l'animation d'un thème seulement lorsque toutes ses surfaces actives
sont qualifiées occultées. Au retour visible, il reprend la même horloge logique sans
recréer la scène. Le provider continue d'appliquer ses propres signaux de sommeil,
session, verrouillage et activité ; les deux sources se combinent sans se remplacer.

## Consequences

Le coût du test de fenêtres n'est payé qu'après un événement pertinent. Le modèle
reste fail-open pour l'affichage et fail-safe pour les entrées : une visibilité
inconnue ne prétend pas économiser l'énergie. Le statut traverse une frontière déjà
existante ; aucun processus, permission, fenêtre, calque ou canal supplémentaire
n'est ajouté.

Cette preuve ne constitue pas une détection générale de toute occlusion, notamment
par les fenêtres jointives de plusieurs applications, Stage Manager ou des surfaces
translucides. Les mesures de puissance incrémentale restent obligatoires avant une
décision de production.
