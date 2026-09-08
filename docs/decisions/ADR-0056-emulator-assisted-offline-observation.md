---
scope:
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/04-experimental-protocol.md
  - docs/research/macos-interaction-and-emulator-boundary.md
review: on-change
---
# ADR-0056 — Observation émulée locale et hors ligne

- Status: accepted
- Date: 2026-09-09

## Context

L'analyse statique et les décompilations existantes ne suffisent pas toujours à
relier une ressource, une variable et un comportement visible. Un émulateur peut
fournir des frames, de l'audio, de la mémoire, des registres ou une trace GPU, mais
ne livre pas automatiquement les concepts sémantiques d'un jeu.

## Decision

L'émulation est un observateur optionnel du convertisseur local, jamais une
dépendance du wallpaper, du terminal ou d'un package partageable. Chaque exécution
épingle outil, core, version du jeu, état initial, inputs, nombre de frames, quotas
et hashes de sortie. Le réseau est interdit et l'entrée reste en lecture seule.

Libretro est le premier candidat pour un runner déterministe commun. Dolphin FIFO,
MAME Lua et les scripts headless Ghidra sont des observateurs spécialisés derrière
le même contrat de preuves. Leur présence ne vaut pas capacité : chaque adaptateur
publie `verified`, `adapted`, `approximated`, `unknown` ou `unsupported` pour les
scènes, collisions, placements, contrôleurs et boucles audio.

La bibliothèque privée conserve les observations et dérivés locaux. La composition
du thème sélectionne seulement les éléments nécessaires. Après conversion, le
runtime doit fonctionner émulateur et convertisseur arrêtés, sans ROM ouverte. Un
contrôleur conçu pour un thème est marqué `adapted`, même s'il réutilise trajectoires,
collisions et animations originales vérifiées.

## Consequences

La conversion universelle reste une capacité extensible par adaptateurs, pas une
promesse de décompilation automatique de tout jeu. L'échec d'un observateur réduit
les capacités du jeu concerné sans fragiliser le cœur produit. Les thèmes officiels
ne redistribuent aucune donnée commerciale extraite.

L'adoption effective d'un outil attend les preuves E6-A à E6-C : répétabilité du
runner, corrélation spécialisée et exécution autonome du résultat.
