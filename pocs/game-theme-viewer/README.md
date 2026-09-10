# Game theme reference viewer

Ce PoC charge un pack local générique composé de `theme.json` et de scènes
`glTF/GLB`. Le manifeste v2 décrit un catalogue d'assets, leurs instances, leurs
transformations, leurs clips optionnels et la caméra. Il ne lit ni ROM, ni fichiers
Fast64/Blender, ni identifiants propres à un jeu. Bevy reste derrière cette frontière
et n'est pas le format du produit.

Chaque asset déclare ses profils sémantique et de rendu. Ce binaire n'implémente que
`gltf.standard`. Une conversion depuis `n64.f3dex2` peut être ouverte comme
`diagnostic`, avec un avertissement et un titre non ambigu ; elle ne constitue pas
une preuve de fidélité. Un profil source qualifié doit être fourni par un adaptateur
et comparé à un oracle Fast3D/RDP.

Le manifeste v3 ajoute les tables source consultées, les rôles sémantiques du rig,
le braquage, alpha, culling, LOD, ombres et caméra du ciel. Une qualification est
refusée tant qu'une approximation est déclarée. Le viewer applique le choix d'ombres ;
les autres paramètres restent des obligations d'adaptateur vérifiables avant rendu.

Le manifeste v3 ajoute les tables source consultées, les rôles sémantiques du rig,
le braquage, alpha, culling, LOD, ombres et caméra du ciel. Une qualification est
refusée tant qu'une approximation est déclarée. Le viewer applique le choix d'ombres ;
les autres paramètres restent des obligations d'adaptateur vérifiables avant rendu.

```bash
cargo run --release --manifest-path pocs/game-theme-viewer/Cargo.toml -- \
  --pack game/packs/clocktower
```

- glisser avec le bouton gauche : orbite ;
- molette : zoom ;
- `R` : caméra initiale.

Le mode `WinitSettings::desktop_app()` évite une boucle continue lorsqu'aucun
événement ne demande de mise à jour. Cela ne vaut pas encore mesure énergétique ni
preuve de rendu dans la `CAMetalLayer` du provider macOS.
