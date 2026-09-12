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
