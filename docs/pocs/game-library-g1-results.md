# Résultats G1 — bibliothèque locale Majora's Mask

État au 9 septembre 2026 : **première indexation complète réussie et premier pont
visuel qualifié ; G1 partiel**. Les critères G1-01, G1-02, G1-03 et la répétabilité
de G1-06 sont prouvés sur la machine MAC-01. Le pont visuel décrit ci-dessous ne
ferme ni les relations sémantiques profondes, ni le compilateur D1, ni G1-04 à G1-10.

## Entrée et chaîne épinglées

| Élément | Valeur vérifiée |
| --- | --- |
| Jeu | Majora's Mask N64, NTSC-U 1.0, identifiant `NZSE`, révision 00 |
| SHA-1 ROM | `d6133ace5afaa0882cf214cf88daba39e266c078` |
| Décompilation/extracteur | `zeldaret/mm` à `486055ebec4c45f3020bfaa5d040698d6c2b85e4` |
| Linker d'outillage | GNU binutils `2.35`, construit avec le zlib système |
| Hôte | macOS 26.2 `25C56`, GNU Make 4.4.1 |
| Indexeur | Rust 1.97.1, schéma `wallpaper-game-library` 1 |

La ROM, le checkout d'extraction, le CAS et les rapports privés se trouvent tous
sous `game/`, chemin ignoré par Git. Aucun de ces contenus n'est ajouté au dépôt.
La dépendance `game/` est volontairement absente de la CI.

## Exécution

La chaîne native documentée par `zeldaret/mm` a exécuté `gmake setup`, puis
`gmake assets`. Elle a produit 25 272 fichiers sous l'arbre extrait. L'indexeur
du produit a ensuite lu cet arbre sans réseau et créé SQLite + CAS.

Commande reproductible, avec chemins privés relatifs au dépôt :

```bash
cargo run --release --manifest-path tools/game-library/Cargo.toml -- index \
  --source game/workspace/mm/extracted/n64-us \
  --output game/library/mm-n64-us \
  --adapter zelda64 \
  --source-id zelda-mm-n64-us-1.0 \
  --source-revision 486055ebec4c45f3020bfaa5d040698d6c2b85e4 \
  --input-sha1 d6133ace5afaa0882cf214cf88daba39e266c078
```

## Résultat observé

| Mesure | Valeur |
| --- | ---: |
| chemins comptabilisés | 25 272 |
| octets logiques indexés | 196 550 076 |
| blobs SHA-256 uniques | 22 377 |
| relations de contenance/référence | 36 625 |
| ressources `understood` | 21 599 |
| ressources `partial` | 2 098 |
| ressources `unknown` | 1 575 |
| digest logique | `821ffc873f4f80aa92c4ca2ad17f5baafc66e12c0ca3665ce2d7c6620d9c977e` |

Deux indexations indépendantes ont produit des fichiers `library.sqlite`
identiques, SHA-256
`f89b7de31e571c62cb0059527351670ca750718514b8793ff3a22576486ba556`,
et des `coverage.json` identiques, SHA-256
`e0c8a9ea162704594d3b37855ffcfccc1786164de6e7c8dc4dbfe93c856c0a06`.
La commande `verify` confirme 25 272 lignes et zéro blob manquant.

Une vérification sémantique de la table source a corrigé une hypothèse initiale :
`Z2_00KEIKOKU` désigne **la Plaine de Termina**, pas Bourg-Clocher. L'index contient
les cinq scènes extérieures de Bourg-Clocher : `Z2_TOWN` (Est, 254 fichiers),
`Z2_ICHIBA` (Ouest, 143), `Z2_BACKTOWN` (Nord, 99), `Z2_CLOCKTOWER` (Sud, 242) et
`Z2_ALLEY` (Lavoir, 68). D1 commence par `Z2_CLOCKTOWER`, puis vérifie la sélection
des quatre autres sans réingestion. Cette liste prouve la requête locale ; pas
encore la fermeture transitive des dépendances D1.

## Limites visibles

L'extraction audio amont a signalé trois limites conservées dans le reçu privé :

- Soundfont 40 avec couverture de fichiers incomplète ;
- Sample Bank 0 avec plages non attribuées `0x449930–0x44A130` et
  `0x530670–0x538CC0` ;
- références à l'instrument 15 invalides dans Soundfont 36 et 37.

Le classement actuel est conservateur et fondé sur chemins/extensions : une source
C ou un fragment de scène est `partial`, même lorsqu'il a été généré correctement.
Les 1 575 entrées opaques sont `unknown`. La prochaine passe doit enrichir les
relations scène → room → acteur → objet et parser les déclarations Zelda64 sans
déplacer ces règles dans le schéma commun.

## Qualification du pont visuel South Clock Town

Une sonde hors ligne a importé `Z2_CLOCKTOWER` avec Fast64, puis remplacé les
graphes de matériaux F3D par un profil glTF volontairement simple avant export.
La sonde emploie Blender 5.1.2 arm64, archive officielle de SHA-256
`f104ffee2ba6aee32328e5c203b7e4608d8a1745f7bbcf2766f3b9777e8fbe17`, et Fast64
à la révision `44b7bd9603382f1ac7c0d1c1c5f1b3abe3008405`.

Le checkout Fast64 amont n'a pas produit cette scène sans modifications locales :
son chemin Majora's Mask reste incomplet pour les enums, macros d'acteurs, chemins,
matériaux animés et collisions rencontrés. Ces modifications demeurent sous le
répertoire privé ignoré `game/` et ne constituent pas un adaptateur redistribuable.

| Observation sur le GLB réimporté dans Blender vierge | Valeur |
| --- | ---: |
| taille du GLB autonome | 278 KiB |
| maillages | 10 |
| sommets après triangulation/dédoublonnage glTF | 2 070 |
| polygones | 969 |
| matériaux | 112 |
| images embarquées | 58 |
| attributs de couleur réimportés | 1 (`COLOR_0`) |
| SHA-256 du GLB | `d9b8fb6834e69eba1f3521330434b575f56accca40e8b9d2a078c37a4abf3c53` |

Cette preuve valide seulement un **pont géométrique**. Le pont texture est rejeté :
une texture `Tex0_*` choisie sans interpréter les commandes de matériau produit un
rendu visiblement faux. Les combineurs N64 ne sont pas préservés ; acteurs,
collisions, chemins et matériaux animés sont absents. Les groupes d'affichage
importés restent fragmentés selon leurs volumes de culling. Fast64/Blender est donc
un outil optionnel d'inspection et de dérivation visuelle derrière le contrat
d'adaptateur, pas la fondation universelle du produit.

La prochaine fermeture utile est structurelle : relier les déclarations de scène
issues de `zeldaret/mm` aux rooms, acteurs, objets, collisions et display lists,
puis compiler un pack minimal déterministe. Bevy ne doit être branché qu'à ce pack,
jamais au fichier `.blend` ni aux types Fast64.
