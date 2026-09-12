---
scope:
  - .agents/skills/game-theme-author/
  - docs/templates/game-theme-authoring-run.schema.json
  - docs/templates/game-theme-authoring-run.example.json
  - scripts/verify-game-theme-authoring-run.mjs
  - tests/theme-authoring.test.mjs
  - docs/architecture/theme-customization.md
  - docs/architecture/src/theme-customization.dataflow.json
  - docs/02-quality-strategy.md
review: on-change
revised: true
---
# ADR-0082 — Ledger de qualification avant le premier lancement natif

- Status: accepted
- Date: 2026-09-12

## Context

Un concept accepté et un inventaire en treize rubriques ne suffisent pas à prévenir
les régressions observées lors d'une première adaptation. Les erreurs de repère,
dépendances incomplètes, boucles d'animation, relations variantes, sockets d'effets,
menus manuels et modifications directes du PoC actif peuvent encore apparaître entre
la recherche et l'activation.

La qualité du premier rendu dépend moins de la vitesse de génération que de l'ordre
des preuves. Cet ordre doit être vérifiable et rester indépendant du jeu et du moteur.

## Decision

Chaque adaptation possède un ledger `orbite.game-theme-authoring-run/1` lié par hash
au concept accepté. Il décrit un candidat privé isolé, le profil du moteur, la
fermeture des dépendances, les familles de relations et deux scènes distinctes.

Le profil moteur fixe les conventions spatiales et la source des sémantiques sensibles.
Les relations `placement`, `attachment`, `effect_origin` et
`interactive_hit_region` sont toujours traitées, éventuellement comme
`not_applicable` prouvé. La scène témoin utilise le même adaptateur et ne peut demander
aucune modification du runtime.

Dix-sept gates sont strictement ordonnés. L'activation native est le dernier. Elle
reste impossible tant que les seize preuves précédentes, dont matrices visuelle et
interactive et pause/occlusion, ne passent pas. Le candidat est construit et exécuté
hors de l'installation active jusque-là.

Le validateur recalcule le hash du concept, réutilise son gate d'acceptation, contrôle
l'ordre, les preuves, les relations, les axes, les dépendances et la scène témoin,
puis retourne séparément `generation_allowed` et `activation_allowed`.

## Consequences

La préparation initiale prend davantage de temps, mais interdit de découvrir au clic
natif des défauts que la source ou un viewer isolé pouvait déjà révéler. Un agent ne
peut plus réinstaller un PoC pour montrer du progrès avant qualification.

Le contrat améliore fortement la probabilité d'un bon premier essai sans promettre une
perfection impossible lorsque le moteur est incomplet ou non documenté. Les inconnues
restent visibles et ferment précisément le gate qui dépend d'elles.
