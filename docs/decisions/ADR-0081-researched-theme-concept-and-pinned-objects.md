---
scope:
  - .agents/skills/game-theme-author/
  - docs/templates/wallpaper-concept.schema.json
  - docs/templates/theme-interface-v5.schema.json
  - docs/architecture/theme-customization.md
  - docs/architecture/src/theme-customization.dataflow.json
  - scripts/verify-wallpaper-concept.mjs
review: on-change
revised: true
---
# ADR-0081 — Recherche préalable, concept accepté et objets 3D épinglés

- Status: accepted
- Date: 2026-09-12

## Context

La première course Mario Kart a bénéficié de nombreuses itérations spécifiques alors
que les suivantes ont exposé les lacunes du pipeline. Un rendu convaincant pouvait
donc être confondu avec une conversion générique. La création commençait aussi avant
que l'utilisateur ait choisi la composition, les objets représentant les sessions et
les interactions attendues.

Le produit doit en outre pouvoir conserver certains objets 3D visibles devant les
fenêtres ordinaires, les éditer différemment de leur apparence et les désactiver sans
perdre leur configuration ni leur session.

## Decision

Toute nouvelle adaptation de jeu commence par la skill `game-theme-author`. Elle mène
une recherche moteur et un inventaire local en lecture seule, étiquette la nature de
chaque preuve, évalue les outils et couvre treize sous-systèmes. Les viewers publics
restent des références ou oracles ; aucun asset commercial externe n'est admis.

Avant toute génération, un document `orbite.wallpaper-concept/1` propose une à cinq
compositions à partir des ressources réellement observées. Il lie chaque objet
interactif à un rôle de session et décrit les cibles pinnables. Seule une proposition
explicitement acceptée par l'utilisateur, sans sous-système `missing` ou `unsupported`,
ouvre le gate de génération. Le validateur rend cette décision mécanique.

Le manifeste d'interface ajoute une capacité `pinning` générique, rendue obligatoire
pour la version 5 par ADR-0084. Le pin partage l'identité et la session de l'instance
de scène. Son clic droit ouvre un
cadre de déplacement/taille ainsi que luminosité et opacité. Acceptation et annulation
sont atomiques ; désactivation et réactivation persistent par objet. Le connecteur OS
possède la politique de niveau de fenêtre et refuse les surfaces protégées.

## Consequences

Une adaptation peut proposer, par exemple, un moyen de transport comme mouvement
ambiant et de petits acteurs comme indicateurs de sessions uniquement si le corpus les
contient. Aucun de ces noms ou rôles n'entre dans le runtime commun.

La génération démarre plus tard, mais son périmètre, ses outils et ses limites sont
connus avant d'engager une conversion coûteuse. Une source incomplète produit un plan
utile et un gate fermé, jamais une prétendue conversion parfaite.
