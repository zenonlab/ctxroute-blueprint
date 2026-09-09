# Theme behavior kernel PoC

Ce PoC isole la logique que le thème doit posséder avant tout raccord graphique :
une trajectoire fermée fournie par données, huit instances liées à huit sessions,
une formation stable, un pas de simulation fixe, une reprise bornée et un directeur
caméra. Il ne lit aucune ROM et ne dépend ni de Bevy, ni d'un émulateur, ni d'une API
de wallpaper.

Le contrat d'entrée est `fixtures/eight-karts.json`. Le contrat de sortie est un
`PresentationSnapshot` sérialisable contenant seulement identités, transformations
et caméra. Un renderer Bevy, Godot ou natif peut donc consommer la même sortie sans
devenir propriétaire de la simulation.

```bash
cargo test --manifest-path pocs/theme-behavior-kernel/Cargo.toml
cargo run --manifest-path pocs/theme-behavior-kernel/Cargo.toml -- \
  pocs/theme-behavior-kernel/fixtures/eight-karts.json
```

La fixture est originale et ne contient aucun asset ou code extrait d'un jeu.
Cette preuve couvre le circuit, la formation, le déterminisme, la suspension et le
cadrage. Elle ne prouve encore ni rendu visuel, ni animation squelettique, ni picking,
ni connexion à de vraies sessions terminal.
