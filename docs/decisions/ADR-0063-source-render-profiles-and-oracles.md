---
scope:
  - pocs/game-theme-viewer/
  - docs/architecture/game-transformation.md
  - docs/pocs/game-library-g1-results.md
  - docs/research/complete-game-theme-poc.md
  - docs/02-quality-strategy.md
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
revised: true
---
# ADR-0063 — Qualifier le rendu par profil source et oracle

- Status: accepted
- Date: 2026-09-09

## Context

Le pont Fast64 vers glTF standard préserve une partie de la géométrie, des textures
et des rigs, mais ne traduit pas les combineurs, tuiles, palettes et modes de rendu
N64. Fast64 décrit ces états dans les extensions glTF expérimentales
`FAST64_materials_n64`, `FAST64_sampler_n64` et `FAST64_materials_f3d`, dont la
documentation amont ne recense actuellement aucune implémentation consommatrice.
Bevy 0.19 fournit des `GltfExtensionHandlers` et des matériaux personnalisés ; il
n'implémente pas pour autant ces sémantiques N64.

Torch associe son visualiseur à libultraship/Fast3D pour un rendu N64 réel. RT64
interprète également les workloads RSP/RDP. Ces projets sont des références utiles,
mais ni un GLB standard, ni Bevy, ni l'exécution permanente du jeu ne doivent être
confondus avec une traduction exacte.

## Decision

Séparer trois responsabilités :

1. Bevy orchestre entités, transformations, animations, caméras, interactions et
   états de thème communs ;
2. un profil de rendu source traduit les sémantiques visuelles d'une famille de
   moteurs (`n64.f3dex2`, puis des profils indépendants) ;
3. un oracle hors ligne rend des vues déterministes depuis un moteur de référence et
   qualifie l'adaptateur avec des comparaisons d'images et d'états.

Chaque asset du pack déclare `semantic_profile`, `render_profile` et
`visual_qualification`. La qualification `qualified` est interdite si les profils
diffèrent. Le visualiseur actuel n'implémente que `gltf.standard` ; une conversion
N64 vers ce profil reste exécutable comme diagnostic et porte cette mention dans le
titre, mais ne ferme aucun gate visuel.

Le prochain PoC N64 commence par l'oracle 2Ship/libultraship-Fast3D sur une fixture
South Clock Town, avec Torch ou RT64 comme contre-références, puis seulement par un interpréteur Fast3D isolé ou un handler glTF
Bevy avec matériau WGSL. L'adaptateur doit réussir le corpus de conformité avant
d'être déclaré qualifié. Aucun identifiant Majora's Mask n'entre dans le cœur Bevy.

## Consequences

Le pack commun reste utilisable pour la 2D, la 3D, les personnages et les sessions,
mais la fidélité n'est plus implicite au format glTF. Chaque console ou moteur peut
apporter un profil indépendant, découvert et préparé hors ligne, sans ajouter son
émulateur au runtime wallpaper. Une sortie inconnue échoue explicitement ou reste
diagnostique ; elle n'est jamais promue par son apparence.

## Sources primaires vérifiées

- [extensions glTF N64 de Fast64](https://github.com/Fast-64/fast64/tree/main/fast64_internal/f3d/glTF) ;
- [exemple officiel des handlers glTF Bevy](https://github.com/bevyengine/bevy/blob/main/examples/gltf/gltf_extension_mesh_2d.rs) ;
- [Torch, processeur d'assets et visualiseur](https://github.com/HarbourMasters/Torch) ;
- [2Ship2Harkinian, port Majora's Mask fondé sur libultraship/Fast3D](https://github.com/HarbourMasters/2ship2harkinian) ;
- [RT64, renderer RSP/RDP](https://github.com/rt64/rt64) ;
- [Zelda64Recomp, oracle d'exécution Majora's Mask fondé sur RT64](https://github.com/Zelda64Recomp/Zelda64Recomp).
