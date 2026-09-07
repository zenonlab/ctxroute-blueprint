---
scope:
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/session-handoff.md
  - docs/document-contracts.json
  - .project/project-config.json
review: on-change
---
# ADR-0030 — Transformer le jeu hors ligne, exécuter une sélection

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur précise que les jeux cités sont des exemples, que la composition
se programme et que la consommation doit être minimale. Il veut préparer le
jeu entier et étudier la récupération des collisions, de la marche et du saut.

## Decision

Étendre ADR-0029 avec quatre responsabilités : lecture hors ligne, bibliothèque
du jeu, composition par code et exécution sélective. Conserver ressources,
relations et comportements compris avec leurs dépendances. Viser des adaptateurs
extensibles par jeu ou moteur et réutiliser les outils existants.

Le jeu complet ne fonctionne pas en arrière-plan. La bibliothèque préparée peut
être large, mais la composition active ne charge et ne calcule que son nécessaire.
L'éditeur grand public n'est pas une priorité. Les sources visuelles peuvent
aider la composition sans constituer une preuve des logiques internes.

## Consequences

La récupération automatique de toutes les mécaniques n'est pas garantie.
Fidélité, contrôles, stratégie de conversion progressive, premier jeu pilote et
budgets restent ouverts. Aucun choix de langage, recompiler, moteur physique,
format ou protocole de plugin n'est accepté par cet ADR.
Le statut du projet reste `template` jusqu'aux décisions techniques.
