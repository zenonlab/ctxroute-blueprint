---
scope:
  - docs/templates/source-relations.schema.json
  - docs/templates/visual-qualification.schema.json
  - scripts/verify-source-relations.mjs
  - scripts/verify-visual-qualification.mjs
  - scripts/verify-active-theme.mjs
  - .agents/skills/methodical-corrector/
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0080 — Matrices de relations dérivées de la source

- Status: accepted
- Date: 2026-09-12

## Context

Une extraction valide peut produire une présentation fausse lorsque les relations
entre variantes sont remplacées par une constante globale. Une capture existante peut
également être comptée comme preuve alors que l'élément attendu est invisible. Ces
échecs ne sont liés à aucun jeu particulier : ils concernent assemblages, points
d'attache, origines d'effets, caméras, audio spatial et toute relation multidimensionnelle.

## Decision

Le convertisseur produit un manifeste `orbite.source-relations/1` pour toute relation
variant selon plusieurs ressources. Les axes et types de relation sont des identifiants
ouverts. Le produit cartésien déclaré est complet et chaque cellule conserve statut,
cardinalité, source, méthode de dérivation, espace, unité et transformation.

La hiérarchie de preuve est table, métadonnée, puis code ou script source exporté en
lecture seule. En l'absence de table, le code exporté est transformé hors runtime en
lignes explicites avec symbole, exporteur, version et SHA-256. La géométrie ou
l'observation restent diagnostiques et ne peuvent recevoir `qualified`. Une cellule
non résolue provoque `reject`; aucun fallback implicite n'existe dans le renderer.

La qualification visuelle v2 est une matrice indépendante reliée au reçu de l'artefact
actif. Chaque cellule lie oracle et capture et exécute les assertions déclarées, parmi
visibilité, origine, échelle, densité, orientation, apparence, timing et occlusion. Un
verdict `qualified` exige toutes les cellules et toutes leurs assertions en succès.

Le reçu actif v2 atteste uniquement l'intégrité des artefacts référencés directement
par le descripteur et du processus observé. Il reste `unreviewed` jusqu'à la
qualification séparée ; l'absence du marqueur `experimental` ne constitue plus une
preuve visuelle.

Les contrats communs ne contiennent aucun identifiant de jeu, type de véhicule,
personnage ou effet commercial. Les octets, exports de code, tables résolues, oracles
et captures privés restent hors Git. Seules des fixtures libres illustrent le format.

## Consequences

Un nouvel adaptateur peut ajouter ses propres axes et relations sans modifier le
noyau, le renderer ou les menus. Les choix et étapes de menu sont générés depuis les
axes résolus et restent des données ouvertes pour le connecteur. La préparation initiale est plus stricte, mais les
corrections deviennent régénérables et les variantes incomplètes échouent avant leur
activation au lieu d'accumuler des offsets compensatoires.
