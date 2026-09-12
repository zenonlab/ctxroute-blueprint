# Bibliothèque locale de jeu

Cet outil hors ligne inventorie un arbre déjà extrait. Il ne lit pas une ROM, ne
lance pas d'émulateur et n'exporte aucun asset dans un package de thème.

Il produit :

- `library.sqlite`, index relationnel sans gros contenu binaire ;
- `blobs/sha256/`, stockage adressé par contenu, créé par hard-link quand possible ;
- `coverage.json`, reçu déterministe sans chemin absolu.

Les statuts ont un sens strict : `understood` signifie que la représentation est
lisible, `partial` que les octets sont structurés mais pas entièrement convertis,
et `unknown` qu'aucune sémantique n'est encore prouvée. Aucun statut n'est déduit
du seul succès de l'extracteur amont.

```bash
cargo test --manifest-path tools/game-library/Cargo.toml
cargo clippy --manifest-path tools/game-library/Cargo.toml --all-targets -- -D warnings

cargo run --release --manifest-path tools/game-library/Cargo.toml -- index \
  --source <arbre-extrait> \
  --output <bibliotheque-privee> \
  --adapter zelda64 \
  --source-id <jeu-version> \
  --source-revision <revision-outil> \
  --input-sha1 <sha1-rom>

cargo run --release --manifest-path tools/game-library/Cargo.toml -- verify \
  --library <bibliotheque-privee>
```

`--adapter generic` vérifie que le contrat commun fonctionne sur une fixture sans
identifiant Zelda. `--no-blobs` permet une seconde indexation de contrôle sans
matérialiser à nouveau le CAS.

L'adaptateur Mario Kart Wii décompresse Yaz0 puis extrait l'archive U8 avec des
limites strictes et sans exécuter le jeu. Il refuse toute sortie hors de `private/`
et inventorie circuit, KCL, KMP, textures, animations, menus, portraits, emblèmes,
boutons, polices, audio, effets et dépendances. Une catégorie absente reste signalée
dans le rapport. Les conteneurs BREFF/BREFT sont classés comme effets privés ; leur
présence dans l'inventaire ne signifie pas qu'ils sont déjà décodés ou rendables.

```bash
cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  extract-mkw-course --input private/source/farm_course.szs \
  --output private/mkw/farm_course

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-mkw-effects \
  --breff private/mkw/common/Effect/RKRace.breff \
  --breft private/mkw/common/Effect/RKRace.breft
```

La seconde commande émet seulement un catalogue JSON de noms, tailles, empreintes,
paramètres d'émission bornés et références de textures. Elle vérifie la fermeture
BREFF→BREFT, ne copie aucun payload et ne prétend pas encore exécuter les émetteurs
NW4R.

L'adaptateur `gcn-j3d` classe les familles de formats GameCube/JSystem sans connaître
de jeu. La commande suivante lit un placement de scène big-endian de façon bornée et
émet son inventaire typé en espace source. La seconde inspecte l'enveloppe J3D,
les sections, les tableaux de sommets, les bornes et les translations de joints.
Elle explicite le passage vers le repère canonique mais ne prétend pas encore
convertir les matériaux GX/TEV ni produire un modèle visuellement qualifié.

```bash
cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-gcn-stage --input private/source/room.dzr

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-j3d-model --input private/source/model.bdl

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-rarc --input private/source/archive.arc

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-j3d-animation --input private/source/animation.bck

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-jai-animation-sound --input private/source/animation.bas

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-j3d-material-animation --input private/source/animation.btk

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-bti-texture --input private/source/texture.bti

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-gx-raw-texture --input private/source/texture.raw \
  --format i8 --width 64 --height 64 --wrap-s clamp --wrap-t clamp

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-fixed-record-table --input private/source/table.bin \
  --magic FREE_TABLE --count-offset 10 --count-encoding u16-be \
  --records-offset 16 --record-size 8

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-j3d-material-table --input private/source/material-table.bmt

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-dzb-collision --input private/source/collision.dzb

cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  inspect-ppc-resource-calls \
  --input private/source/linked.elf \
  --module actor-controller \
  --start 0x80001000 --end 0x80002000 \
  --sda2-base 0x80400000 --sda-base 0x803f8000 \
  --api resource.load=0x80050000:r4
```

L'inspection RARC reconstruit l'arbre logique, calcule l'empreinte de chaque payload
et expose les drapeaux de compression sans matérialiser les fichiers. Les noms avec
traversée, les cycles, les plages hors limites et les cardinalités excessives sont
refusés.

L'inspection d'animation lit actuellement les pistes squelettiques BCK/ANK1. Elle
conserve l'attribut de lecture source, la durée — y compris une pose statique de
durée zéro —, le nombre de joints, les cardinalités des tables et les axes de
translation animés du joint racine. Elle contrôle chaque index et mode de tangente,
mais ne décide ni d'une transition ni du propriétaire du mouvement global : ces
deux relations doivent être prouvées par le contrôleur source.

Le lecteur reconnaît aussi les tables sonores JAI/BAS autonomes et celles annexées
après `ANK1`. Il conserve les identifiants, fenêtres de frames, pitch, flags, volume,
boucles et panoramique ; les tailles, pointeurs sérialisés, valeurs flottantes et
octets de bourrage sont validés. Le bloc sonore ne peut donc plus être confondu avec
une section d'animation corrompue ou ignoré lors de la conversion.

Les animations de matériau J3D restent des familles séparées : transformation SRT
de texture BTK/TTK1, motif de texture BTP/TPT1, couleur matériau BPK/PAK1 et registres
TEV BRK/TRK1. Le rapport conserve mode de lecture, durée, noms et identifiants des
matériaux, slots, centres SRT et cardinalités des pistes. Chaque offset, table de noms,
index et mode de tangente est borné. Pour BTK, la valeur brute du calcul matriciel et
la valeur effective sont toutes deux exposées lorsque le loader source applique son
fallback documenté.

Le lecteur BTI conserve le format GX, la valeur alpha source, les dimensions, wraps,
filtres, niveaux de mipmap, LOD, anisotropie, palette et plages de données. Le calcul
de taille suit les tuiles GX propres à chaque format, y compris RGBA8 et CMPR. Une
incohérence format indexé/palette, un niveau impossible ou une plage tronquée ferme
l'inspection ; le lecteur n'effectue encore ni décodage RGBA ni approximation de
matériau.

Les textures GX sans en-tête sont inspectées par le même calcul de tuiles, mais leur
format, leurs dimensions, leurs wraps, leurs mipmaps et leur éventuelle palette sont
des arguments obligatoirement fournis par une relation source privée. Le lecteur
exige que l'image et la palette terminale explicitement déclarée expliquent exactement
tous les octets. Il ne déduit aucun paramètre du nom ou de la taille du fichier.

Le lecteur de tables fixes est lui aussi configuré : magic attendu, offset et largeur
du compteur, endian, début et taille des enregistrements. Il vérifie que le compteur
explique exactement le payload et publie seulement les empreintes des enregistrements,
sans inventer la sémantique de leurs champs.

L'inspection BMT accepte les compositions `MAT3`, `TEX1` ou les deux, comme le loader
J3D source. Elle résout les remaps de matériaux, noms, modes et huit slots vers les
indices de textures, puis applique le même lecteur BTI aux entrées TEX1. Le rapport
distingue les bindings externes et une déclaration de sections incomplète. Il ne
qualifie pas encore les opérations TEV, blend, alpha, fog ou depth référencées par
les tables MAT3.

Le lecteur DZB conserve sommets, triangles, propriétés, blocs, arbre spatial et
hiérarchie de groupes en repère source. Il vérifie chaque référence croisée, les noms,
les transforms finies et les bornes asymétriques. Ce reçu qualifie la structure de
collision ; il ne transforme pas automatiquement une propriété physique en matériau
visuel ou en comportement de thème.

L'inspection PPC complète cette preuve quand le source exporté est incomplet. Elle
lit un ELF32 big-endian borné, limite l'analyse à une plage exécutable explicite ou
à l'unique section liée et
résout seulement les chaînes dont l'adresse reste prouvable par propagation de
constantes. Les adresses d'API, le registre portant le nom et les bases ABI `r2`/`r13`
sont des entrées de l'adaptateur : aucun nom de jeu ou d'archive n'est codé dans
l'outil. Un appel ambigu reste `null` et ne peut pas fermer une dépendance.
