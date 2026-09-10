# Theme behavior kernel PoC

Ce PoC isole la logique que le thème doit posséder avant tout raccord graphique :
une trajectoire fermée fournie par données, huit instances liées à huit sessions,
une formation stable, un pas de simulation fixe, une reprise bornée et un directeur
caméra. Il ne lit aucune ROM et ne dépend ni de Bevy, ni d'un émulateur, ni d'une API
de wallpaper.

M0 fige huit ticks de référence dans la recette. Le binaire calcule les empreintes de
la recette, de lui-même, d'un éventuel arbre d'assets privé et de chaque snapshot.
Les compteurs distinguent simulation, rattrapage, pause et occlusion ; les champs GPU,
rendu, allocation et pacing restent explicitement non observés dans ce noyau sans GPU.

Le contrat d'entrée est `fixtures/eight-karts.json`. Le contrat de sortie est un
`PresentationSnapshot` sérialisable contenant seulement identités, transformations
et caméra. Un renderer Bevy, Godot ou natif peut donc consommer la même sortie sans
devenir propriétaire de la simulation.

```bash
cargo test --manifest-path pocs/theme-behavior-kernel/Cargo.toml
cargo run --manifest-path pocs/theme-behavior-kernel/Cargo.toml -- \
  pocs/theme-behavior-kernel/fixtures/eight-karts.json \
  --receipt dist/qualification/m0-reference.json
```

La fixture est originale et ne contient aucun asset ou code extrait d'un jeu.
Cette preuve couvre le circuit, la formation, le déterminisme, la suspension et le
cadrage. Elle ne prouve encore ni rendu visuel, ni animation squelettique, ni picking,
ni connexion à de vraies sessions terminal.

M3 ajoute les états `idle`, `active`, `busy`, `success`, `error`, `recovering`, une
réaction de roulis/suspension et cinq familles d'effets bornés. Un identifiant
d'événement déjà traité ne rejoue aucun effet. Le contrôleur de récupération — rôle
que le thème peut présenter comme Lakitu — possède temporairement l'autorité puis la
rend explicitement au trajet ; ce n'est pas l'IA du jeu original.

M5 ajoute un simulateur déterministe de sessions. Son protocole se limite aux
événements typés de connexion, activité et déconnexion et aux intentions `focus` et
`open`. Les séquences sont monotones, les événements sont idempotents et aucune
commande shell, PTY ou donnée de terminal n'entre dans le contrat.
