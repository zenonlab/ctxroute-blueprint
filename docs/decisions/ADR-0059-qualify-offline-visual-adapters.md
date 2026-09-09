---
scope:
  - docs/pocs/game-library-g1-results.md
  - docs/research/complete-game-theme-poc.md
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0059 — Qualifier les adaptateurs visuels hors ligne sans les adopter comme socle

- Status: accepted
- Date: 2026-09-09

## Context

La première scène Majora's Mask devait vérifier si un lecteur existant pouvait
produire un dérivé visuel exploitable sans écrire immédiatement un renderer ou un
parseur spécifique. Fast64 offre un import F3D dans Blender, mais son chemin
Majora's Mask ne couvre pas toutes les structures observées dans `Z2_CLOCKTOWER`.

Un export glTF réussi ne démontre ni les relations de scène, ni les collisions, ni
les acteurs, ni la fidélité des combineurs N64. Inversement, ces limites ne rendent
pas inutile une brique capable de convertir une partie vérifiée des données.

## Decision

Les lecteurs et convertisseurs existants sont qualifiés **par capacité et par
version**, derrière l'adaptateur hors ligne. Aucun d'eux ne devient le format
canonique, le runtime, ni l'adaptateur universel du produit.

La sonde Fast64/Blender pour `Z2_CLOCKTOWER` est acceptée uniquement comme pont
visuel `approximated` : géométrie, textures et couleurs de sommets sont présentes
dans un GLB réimportable ; acteurs, collisions, chemins, matériaux animés et
combineurs exacts restent `missing` ou `unsupported`.

Les données et relations de `zeldaret/mm` restent la source canonique privée de
l'adaptateur Zelda64. Le compilateur de thème consomme un modèle intermédiaire
propre au produit et produit un pack commun. Bevy consomme ce pack ; il ne dépend
pas de Blender, Fast64 ou d'un fichier `.blend`.

Les correctifs exploratoires, ROMs et dérivés contenant des assets restent sous
`game/`, ignoré par Git. Un correctif ne peut devenir une dépendance produit qu'après
isolation, licence, tests de répétabilité et qualification explicite.

## Consequences

Le projet réutilise les outils publics sans leur déléguer ses contrats. Une nouvelle
console ou un moteur custom peut employer une chaîne différente tout en produisant
les mêmes capacités et le même pack.

Le premier GLB de South Clock Town est une preuve de faisabilité partielle, pas la
fermeture de D1. La prochaine étape porte sur les relations scène → room → acteur →
objet → collision → display list depuis la bibliothèque indexée, puis sur un pack
minimal déterministe avant l'intégration Bevy.
