# Résultats — adaptateur de course Mario Kart Wii

Date : 10 septembre 2026

Périmètre : `tools/game-library`

## Résultat exécutable

L'adaptateur Yaz0/U8 est hors ligne, borné à 1 Gio et 65 536 entrées, refuse les
noms traversants et toute sortie hors de `private/`. Une archive U8 originale de
test produit trois fichiers classés circuit, collision KCL et route KMP.

```text
cargo test --manifest-path tools/game-library/Cargo.toml
10 passed; 0 failed

cargo clippy --manifest-path tools/game-library/Cargo.toml --all-targets -- -D warnings
finished successfully
```

Le rapport inventorie aussi textures, animations, menus, portraits, emblèmes,
boutons, polices, audio, effets et dépendances, et liste les catégories attendues
absentes au lieu d'en déduire une couverture.

L'archive locale `Common.szs` a également été extraite sans publier ses octets.
Son répertoire U8 transparent `.` est accepté sans relâcher les contrôles de
traversée. L'inventaire contient 100 fichiers, dont `RKRace.breff` et
`RKRace.breft`, classés comme ressources d'effet privées. Cette présence ne vaut
pas encore décodage, fermeture de dépendances ni fidélité de rendu.

Le lecteur de catalogue BREFF/BREFT valide les en-têtes, bornes, tables, noms et
payloads sans les exporter. Sur la source locale, il retrouve 516 effets nommés et
93 textures, dont `rk_driftSmoke`, les familles d'étincelles bleues/oranges,
`rk_jumpSmoke` et `rk_miniTurbo`. Le reçu ne contient que noms, tailles et SHA-256.
Il normalise aussi le volume d'émission, la durée, le débit, les frames et jusqu'à
trois références de textures par effet, puis refuse une dépendance absente du BREFT.
Sur la source locale, les 516 dépendances d'effets se ferment sans référence manquante.

`compile-mkw-effects` ferme maintenant un sous-ensemble nommé dans un pack privé
`orbite.resolved-effects/1`. La conversion corrige la portée BREFT (en-tête ressource
de 0x20 octets en plus des tailles données par la table), décode I8 et IA8 tuilés vers
RGBA8, remplace les noms Nintendo par des identifiants opaques et lie chaque fichier
à son SHA-256. La provenance du pack utilise la table générique `source_artifacts` ;
les noms BREFF/BREFT restent confinés à l'adaptateur. Le profil résolu transporte les
paramètres d'émetteur, l'héritage de
translation et les pistes AB de taille, échelle et alpha ; les pistes restantes sont
comptées et empreintées sans être revendiquées comme exécutées.

La source locale `RKRace` produit un pack de 9 effets et 4 textures, dont fumées de
dérapage/saut, étincelles bleues/oranges et mini-turbo. Le pack et ses pixels restent
sous `private/`; seuls le compilateur, ses contrats et ses fixtures synthétiques sont
commitables.

## Gate privé restant

`farm_course.szs` n'existe ni sous `private/` ni dans les entrées locales disponibles.
Sa conversion réelle et la comparaison avec la première course ne sont donc pas
exécutées. Fournir ce fichier commercial localement sous `private/source/` permettra
d'exécuter la commande documentée sans changement du runtime ni commit d'asset.
