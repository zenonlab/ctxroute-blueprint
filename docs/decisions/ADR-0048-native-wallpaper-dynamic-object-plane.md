---
scope:
  - pocs/macos-surface/**
  - docs/pocs/macos-surface.md
  - docs/architecture/theme-interactions.md
  - docs/architecture/src/macos-surface-poc.architecture.json
review: on-change
revised: true
---
# ADR-0048 — Fond natif persistant et plan d’objets dynamique

- Status: accepted
- Date: 2026-09-08

## Context

Le wallpaper Apple qualifié par ADR-0047 sait conserver un décor animé natif et
recevoir des commandes depuis son application compagnon, mais ne reçoit pas les
clics géométriques du bureau. L'ancien essai ADR-0046 rendait un objet fixe dans
une seconde fenêtre et dupliquait une partie de la représentation. Il ne modélisait
ni plusieurs objets, ni une formation courbe, ni l'arrêt du plan dynamique hors
du bureau.

Une scène de course doit pouvoir représenter plusieurs sessions par des véhicules
qui tournent, gardent un ordre stable et ouvrent un panneau. Cette logique ne peut
être reconstruite séparément par le fond et la couche cliquable sans risque de
décalage visuel.

## Decision

Retenir deux plans aux responsabilités asymétriques :

1. l'extension wallpaper possède le rendu visible, la piste, les véhicules et leurs
   animations ; aucun pixel d'objet n'est dessiné par le compagnon ;
2. un processus compagnon crée seulement de petites zones de hit-test transparentes
   non activantes et le panneau natif demandé après sélection ;
3. le thème définit une fonction déterministe contenant identité, position et
   orientation normalisées. Le wallpaper possède l'animation ; le compagnon évalue
   seulement la projection au temps monotone courant et reproduit la progression
   curviligne `paced` de Core Animation par une table immuable de longueur d'arc. Il
   ne maintient aucun second état de simulation ;
4. le thème décrit les objets, couleurs, piste et slots dans une ressource externe
   validée ; aucune règle propre à un jeu n'entre dans le cœur ;
5. en mode wallpaper natif, le plan dynamique reste prêt sous les fenêtres normales
   afin que le premier clic sur un objet dégagé fonctionne sans activation préalable
   de Finder. Il est retiré lors de la veille ou d'une session inactive. Le fond
   natif reste géré par macOS ;
6. chaque fenêtre d'objet est sa propre région de clic. Aucune fenêtre transparente
   plein écran, hook global, permission Accessibilité ou polling d'entrée n'est ajouté.

Le mode `desktop --split-input --overlay-only` matérialise la partie hit-test sans
redessiner le fond ni les objets. Le mode `desktop --split-input` historique reste une sonde
autonome capable de dessiner aussi son décor AppKit ; ce n'est pas le wallpaper
natif final.

## Consequences

Les objets 2D, sprites ou objets 3D peuvent utiliser le même contrat de transformation.
Leur rendu futur est remplaçable sans changer la logique de formation. Le POC actuel
utilise quatre véhicules vectoriels originaux rendus par Core Animation dans
l'extension ; aucun asset de jeu.

Les zones de hit-test au niveau `normal - 1` demeurent au-dessus des icônes Finder.
Même invisibles, elles peuvent donc intercepter une icône placée au même endroit.
Le test valide architecture, déterminisme, séparation minimale et cycle de vie ;
il ne qualifie pas encore la superposition avec une icône native, Mission Control,
Spaces réels, multi-écran ou consommation électrique.

Le POC empaquette encore deux fixtures adaptées à leurs schémas respectifs :
`interactive-theme.json` pour l'extension et `formation-theme.json` pour la sonde.
Elles portent actuellement les mêmes identités et paramètres de formation, mais ce
n'est pas une source unique vérifiée. La production devra générer les deux vues depuis
un manifeste canonique ou leur appliquer un contrôle de cohérence au packaging.

Le niveau `normal - 1` maintient les hit-boxes sous les fenêtres applicatives normales,
mais ce comportement doit encore être qualifié avec Stage Manager, Mission Control,
Spaces et les fenêtres système utilisant des niveaux atypiques. Une qualification OS
ultérieure devra décider entre cette politique, des zones réservées ou un mode
interactif explicite, sans réintroduire de surveillance globale intrusive.
