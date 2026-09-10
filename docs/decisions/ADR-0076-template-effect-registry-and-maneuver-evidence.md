---
scope:
  - pocs/theme-behavior-kernel/
  - pocs/game-theme-viewer/
  - tools/game-library/
  - docs/architecture/game-transformation.md
  - docs/architecture/ai-prepared-behaviors.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/pocs/theme-design-poc.md
  - docs/02-quality-strategy.md
review: on-change
revised: true
---
# ADR-0076 — Registre d'effets du template et preuve des manœuvres

- Status: accepted
- Date: 2026-09-10

## Decision

Les effets visuels et audio sont des ressources du catalogue privé, résolues par le
compilateur dans des slots du template. Un binding relie un événement sémantique
opaque à un identifiant d'effet, un type exécutable borné et une durée. Le noyau
n'associe lui-même aucun état à une particule, un sprite, un son, un matériau ou une
impulsion caméra. L'hôte de rendu reçoit seulement des commandes typées et des handles
déjà résolus ; il ne fabrique pas une approximation quand une ressource manque.

Les adaptateurs Nintendo inventorient BREFF/BREFT comme effets et textures d'effets
privés. Une fidélité Mario Kart exige ensuite leur décodage, leur fermeture de
dépendances et une comparaison à l'oracle local. Un primitive Bevy procédural ne peut
pas être présenté comme remplacement fidèle d'un effet source.

Une courbure ou une surface ne prouve pas une action de conduite. Un dérapage exige
un événement produit par une trace d'entrée ou par un contrôleur de thème déclaré qui
modélise au minimum demande, maintien et relâchement de la manœuvre. La courbure peut
alimenter l'anticipation de ce contrôleur, mais ne devient jamais directement un
signal de dérapage. Sans trace ou contrôleur qualifié, aucun dérapage n'est émis.

## Consequences

Les mêmes états peuvent choisir des effets différents selon le template, et un même
effet peut être lié à plusieurs événements sans modifier le noyau. Les thèmes non
Mario Kart utilisent le même registre avec leurs propres ressources et événements.
Le thème Luigi Circuit doit temporairement conserver uniquement les comportements
prouvés par KCL et désactiver ses faux dérapages jusqu'à qualification du contrôleur.
