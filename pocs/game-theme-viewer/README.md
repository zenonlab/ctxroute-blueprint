# Game theme reference viewer

Ce PoC charge un pack local générique composé de `theme.json` et d'une scène
`glTF/GLB`. Il ne lit ni ROM, ni fichiers Fast64/Blender, ni identifiants propres à
un jeu. Bevy reste derrière cette frontière et n'est pas le format du produit.

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
