---
scope:
  - docs/architecture/theme-customization.md
  - docs/architecture/theme-interactions.md
  - docs/architecture/game-transformation.md
  - docs/architecture/src/theme-customization.dataflow.json
  - docs/pocs/theme-design-poc.md
  - docs/02-quality-strategy.md
review: on-change
---
# ADR-0064 — Apparences et caméras indépendantes de la source

- Status: accepted
- Date: 2026-09-09

## Context

Un thème de course peut représenter plusieurs sessions par des véhicules alignés,
laisser l'utilisateur choisir leur personnage ou leur coloris et proposer plusieurs
cadrages. Les mêmes besoins existent pour une scène 2D, un RPG 3D ou un moteur
propriétaire. Les implémenter avec des APIs ou identifiants de chaque jeu rendrait le
runtime impossible à maintenir et obligerait à conserver un émulateur actif.

La personnalisation doit aussi préserver l'identité fonctionnelle : remplacer le
kart associé à une session ne doit pas relancer le terminal, modifier sa trajectoire
ou créer une nouvelle instance logique.

## Decision

1. Normaliser après conversion deux contrats optionnels : `appearance_set` pour les
   variantes d'une instance et `camera_rig` pour les cadrages et contrôles caméra.
2. Garder `instance_id`, `session_binding`, trajectoire et état logique indépendants
   de la ressource visuelle sélectionnée.
3. Exposer les couleurs par canaux sémantiques et masques déclarés, jamais par une
   multiplication arbitraire de toutes les textures.
4. Exiger une signature de compatibilité pour tout échange de ressource riggée. Le
   retargeting est un dérivé hors ligne qualifié, pas une heuristique du runtime.
5. Normaliser les caméras en rigs `fixed`, `orbit`, `follow`, `rail`, `cinematic` ou
   `parallax_2d`, avec paramètres bornés, fallback et politique de mouvement.
6. Importer les caméras et chemins d'un jeu uniquement comme données ou presets. Le
   runtime exécute notre logique et ne rappelle jamais le moteur ou l'émulateur source.
7. Générer la modale depuis les capacités réellement déclarées. Une option absente
   reste invisible ; une incompatibilité est refusée explicitement.
8. Rendre le contrôle caméra explicite, annulable et événementiel afin de préserver
   les entrées OS et de revenir au repos sans invalidation inutile.

## Consequences

Un thème Mario Kart peut associer chaque session à une instance stable, changer son
pilote, sa livrée ou sa caméra et conserver notre algorithme de formation et de course.
Un thème 2D utilise le même contrat avec des sprites et une parallaxe. Le cœur demeure
identique ; seules les ressources et capacités produites par les adaptateurs varient.

Cette abstraction ne promet pas qu'une ressource sera extractible depuis n'importe
quelle ROM. Chaque adaptateur doit prouver sa couverture et sa compatibilité. Le coût
est reporté dans la conversion et la qualification hors ligne, tandis que le runtime
reste petit, déterministe et sans émulateur permanent.
