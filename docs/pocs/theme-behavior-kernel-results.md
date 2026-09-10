# Résultats — noyau de comportements de thème

Date : 10 septembre 2026

Machine : environnement de développement local macOS, Rust 1.97.1

Périmètre : `pocs/theme-behavior-kernel`

## Objet de la preuve

Isoler la logique temps réel minimale d'un thème de course avant tout choix de
renderer : piste fournie par données, huit instances liées à des sessions, formation,
horloge fixe, reprise bornée et caméra de groupe. Aucun asset tiers, code de jeu,
émulateur, moteur graphique ou service réseau n'est chargé.

## Entrée et sortie

La fixture originale `fixtures/eight-karts.json` contient neuf points de contrôle,
les offsets longitudinaux/latéraux de huit instances et les bornes caméra. Le noyau
produit un `PresentationSnapshot` sérialisable comprenant le numéro de pas, le temps
logique, les identités, les positions/orientations et la caméra. Il ne publie aucun
type propre à Bevy ou à une plateforme.

## Vérifications exécutées

```text
cargo test --manifest-path pocs/theme-behavior-kernel/Cargo.toml
17 passed; 0 failed

cargo clippy --manifest-path pocs/theme-behavior-kernel/Cargo.toml --all-targets -- -D warnings
finished successfully

cargo run --quiet --manifest-path pocs/theme-behavior-kernel/Cargo.toml -- \
  pocs/theme-behavior-kernel/fixtures/eight-karts.json \
  --receipt dist/qualification/m0-reference.json
receipt produced with eight deterministic checkpoints through tick 900
```

Les assertions couvrent :

- huit identités d'instance et huit identités de session distinctes ;
- refus d'une identité d'instance dupliquée ;
- égalité de la position et de la tangente au raccord de boucle ;
- ordre stable et transformations finies pendant deux tours complets ;
- snapshots identiques entre deux noyaux sur 2 000 pas identiques ;
- déplacement de caméra limité à sa vitesse configurée et ancres dans la safe area ;
- gel complet en pause et au plus quatre pas lors d'une reprise après 60 secondes ;
- huit empreintes de snapshot identiques entre deux exécutions ;
- arrêt de la simulation et comptage des transitions sous occlusion.
- cycle de sessions connexion, activité, erreur, récupération et reconnexion ;
- cinq passes M6 alternées, statistiques descriptives et métriques absentes explicites ;
- refus d'une soumission GPU déclarée pendant pause ou occlusion ;
- sorties limitées au `private/` ou `dist/` du workspace, sans traversée ni symlink.

## Verdict et limites

La frontière comportement → snapshot est suffisamment déterministe pour recevoir un
adaptateur de rendu. Cette preuve ne qualifie pas encore l'aspect d'un kart, le
skinning, une animation, les collisions, le picking, la télémétrie d'un vrai terminal,
le renderer Bevy ou une surface wallpaper. D1-26 à D1-28 restent donc ouverts au
niveau intégration même si leur sous-contrat logique est couvert.

Le viewer Bevy reste un adaptateur séparé. Sa qualification complète exige encore
un pack privé fidèle, son raccord à WallpaperAgent et les mesures natives décrites
dans le préflight M6 ; aucun de ces résultats n'est déduit du test du noyau.
