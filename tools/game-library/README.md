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
dans le rapport.

```bash
cargo run --release --manifest-path tools/game-library/Cargo.toml -- \
  extract-mkw-course --input private/source/farm_course.szs \
  --output private/mkw/farm_course
```
