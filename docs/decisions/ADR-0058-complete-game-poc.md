---
scope:
  - docs/pocs/theme-design-poc.md
  - docs/research/complete-game-theme-poc.md
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/architecture/src/product-roadmap.workflow.json
review: on-change
revised: true
---
# ADR-0058 — Jeu complet indexé avant composition sélective

- Status: accepted
- Date: 2026-09-09

## Context

Le premier plan D1 reposait sur une petite fixture originale. Elle pouvait prouver
un rig, quelques interactions et une recette, mais pas que l'infrastructure sait
comprendre un vrai jeu, préserver ses relations puis produire plusieurs thèmes sans
réingestion. Le produit exige également une scène soignée et non un panneau technique.

Adopter immédiatement Godot, Bevy, wgpu ou Filament confondrait le format du produit
avec un renderer avant d'avoir testé la vraie surface wallpaper et l'énergie.

## Decision

Le prochain programme de preuve comporte deux gates successifs et obligatoires :

1. G1 indexe un corpus local complet épinglé, avec chaque chemin comptabilisé et une
   couverture typée par catégorie ;
2. D1 compile depuis cette bibliothèque une composition soignée qui ne charge que
   les dépendances nécessaires.

Majora's Mask N64 NTSC-U 1.0 est le premier corpus de référence, identifié par le
SHA-1 `d6133ace5afaa0882cf214cf88daba39e266c078`. Sa ROM et ses données restent
locales et ne sont jamais ajoutées au package partageable. Le choix valide
l'adaptateur Zelda64, pas un traitement spécial dans le cœur et pas une promesse
de conversion automatique de toutes les ROMs.

La bibliothèque utilise conceptuellement un index SQLite et un stockage de blobs
adressés par contenu. Le pack compilé emploie des formats ouverts et des identifiants
stables ; glTF ne porte ni le gameplay ni la provenance à lui seul.

Le premier comportement adapté est le cycle vivant du sud de Bourg-Clocher
(`Z2_CLOCKTOWER`) : horloge contrôlée, états temporels, trajectoires planifiées
de PNJ et transitions réversibles. Les zones Est (`Z2_TOWN`), Ouest (`Z2_ICHIBA`),
Nord (`Z2_BACKTOWN`) et Lavoir (`Z2_ALLEY`) éprouvent ensuite la sélection sans
réingestion. `Z2_00KEIKOKU` reste correctement identifié comme Plaine de Termina.
Toute dépendance à la logique originale est citée ; le résultat n'est pas étiqueté
comme simulation originale complète.

Le renderer reste derrière `RenderHost`. Bevy est choisi pour le PoC parce qu'il
réutilise wgpu, un graphe de scène, l'animation et l'ECS sous licence permissive.
Son raccord à la vraie `CAMetalLayer` doit être prouvé ; un rendu dans une fenêtre
Bevy ordinaire ne valide pas le wallpaper.

Les comportements déclaratifs sont prioritaires. WebAssembly n'est ajouté que si un
cas réel dépasse le graphe typé et après mesure de ses limites et de son coût.

## Consequences

D1 devient plus exigeant mais fournit un progrès réutilisable : index complet,
compilateur, provenance, sélection de dépendances et thème démontrable. L'ajout d'un
second jeu remplace seulement l'adaptateur et ses qualifications.

La couverture complète signifie « tout est comptabilisé », non « tout est compris ».
Les inconnues restent visibles. Le runtime ne lance ni Majora's Mask, ni
2Ship2Harkinian, ni un émulateur en arrière-plan.

Bevy est adopté pour ce PoC, pas encore qualifié comme stack de production. Le terminal réel
reste hors de D1 ; des états de sessions synthétiques valident uniquement les slots
et transitions du thème.
