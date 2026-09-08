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
2. un processus compagnon installe un `CGEventTap` actif, évalue le hit-test à
   l'instant de l'événement et ouvre le panneau natif demandé après sélection ;
3. le thème définit une fonction déterministe contenant identité, position et
   orientation normalisées. Le wallpaper possède l'animation ; le compagnon évalue
   seulement la projection au temps monotone courant et reproduit la progression
   curviligne `paced` de Core Animation par une table immuable de longueur d'arc. Il
   ne maintient aucun second état de simulation ;
4. le thème décrit les objets, couleurs, piste et slots dans une ressource externe
   validée ; aucune règle propre à un jeu n'entre dans le cœur ;
5. en mode wallpaper natif, aucune fenêtre ne suit les objets. Le panneau est un HUD
   natif fixe en haut à droite, repositionné seulement avec la géométrie d'écran ; sa
   région est exclue du hit-test global afin qu'un objet passant derrière ne reçoive
   jamais le clic de ses boutons. Le moniteur est retiré
   lors de la veille, d'une session inactive ou de l'arrêt du compagnon. Le fond natif
   reste géré par macOS ;
6. le tap retourne `nil` pour l'appui et le relâchement d'un clic confirmé sur un objet afin d'empêcher
   l'action « cliquer sur le fond pour afficher le bureau ». Tous les autres événements
   sont restitués inchangés ;
7. masquer les fichiers du bureau est une action locale séparée et explicite. Le POC
   isole l'accès à la préférence Finder non documentée `CreateDesktop`, demande ensuite
   la relance de Finder, et ne déplace ni ne supprime les fichiers. Aucun smoke ne
   déclenche cette mutation. Aucune fenêtre transparente plein écran et aucun polling
   d'entrée n'est ajouté ; le tap exige l'autorisation Accessibilité macOS.

Le mode `desktop --split-input --overlay-only` matérialise la partie hit-test sans
redessiner le fond, les objets ou des fenêtres mobiles. Le mode `desktop --split-input` historique reste une sonde
autonome capable de dessiner aussi son décor AppKit ; ce n'est pas le wallpaper
natif final.

## Consequences

Les objets 2D, sprites ou objets 3D peuvent utiliser le même contrat de transformation.
Leur rendu futur est remplaçable sans changer la logique de formation. Le POC actuel
utilise quatre véhicules vectoriels originaux rendus par Core Animation dans
l'extension ; aucun asset de jeu.

Le tap actif supprimerait aussi un clic destiné à une icône Finder superposée. Tant
que le compagnon ne sait pas exclure cette icône avant de consommer l'événement, le
wallpaper prendrait incorrectement la priorité. Le test valide architecture,
déterminisme et absence de fenêtre mobile ; il ne qualifie pas encore la priorité
d'une icône native, Mission Control, Spaces réels ou le multi-écran.

`CreateDesktop` n'est pas un contrat public Apple. Une rupture sur une version future
de macOS doit désactiver uniquement ce bouton, sans affecter le wallpaper, les objets
ou les fichiers. La valeur courante décide toujours du libellé Masquer/Afficher.

Le POC empaquette encore deux fixtures adaptées à leurs schémas respectifs :
`interactive-theme.json` pour l'extension et `formation-theme.json` pour la sonde.
Elles portent actuellement les mêmes identités et paramètres de formation, mais ce
n'est pas une source unique vérifiée. La production devra générer les deux vues depuis
un manifeste canonique ou leur appliquer un contrôle de cohérence au packaging.

Une qualification OS ultérieure devra ajouter le filtrage des fenêtres et icônes
prioritaires, puis mesurer le coût au repos du tap actif. Si l'utilisateur refuse
l'autorisation Accessibilité, l'interaction reste désactivée et le wallpaper continue.
