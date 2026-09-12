---
scope:
  - tools/game-library/
  - pocs/game-theme-viewer/
  - docs/architecture/src/game-transformation.architecture.json
  - docs/architecture/game-transformation.md
review: on-change
revised: true
---
# ADR-0086 — Adaptateur hors ligne GameCube/J3D borné

- Status: accepted
- Date: 2026-09-12

## Contexte

Le pipeline local sait indexer un arbre générique et convertir certaines familles
Wii, mais il ne possède pas de lecteur qualifié pour les conteneurs et graphes de
scène GameCube/J3D. Utiliser directement un viewer public créerait une seconde
architecture d'exécution et ne produirait ni relations normalisées, ni reçus, ni
preuves de repère consommables par le runtime commun.

## Décision

Un adaptateur hors ligne source-neutre lit des entrées bornées et produit un profil
moteur résolu. Ses modules suivent les familles de format, pas un jeu : flux de
disque, compression, archives, scènes J3D, matériaux GX/TEV, textures, animations,
placements, collisions, effets et audio. Les identifiants particuliers à une œuvre
restent des valeurs opaques dans les manifestes privés.

Le premier incrément implémente l'enveloppe commune, la détection sûre, les repères
et l'inventaire structurel. Chaque capacité supplémentaire doit conserver limites de
taille et de cardinalité, provenance SHA-256, erreurs explicites et tests sur fixtures
libres. Aucun fallback glTF standard ne peut être déclaré visuellement qualifié pour
un matériau dont les opérations GX/TEV ne sont pas traduites ou prouvées équivalentes.

Le convertisseur matérialise ses résultats seulement sous `private/`. Le viewer Bevy
consomme les contrats portables et ne connaît ni extension GameCube, ni nom de jeu,
ni nom de ressource. Le candidat isolé doit convertir une scène témoin
structurellement différente sans modification du runtime avant toute activation
native.

Quand le source exporté ne matérialise pas une relation de ressource, l'adaptateur
peut analyser un ELF32 PowerPC big-endian lié. La plage de code est explicite ou
réduite à l'unique section liée ; les adresses des API, le registre d'argument et les
bases ABI de petites données sont fournis explicitement.
La propagation de constantes est conservative : elle produit une adresse et un nom
uniquement quand ils restent prouvables au point d'appel, sinon la relation demeure
inconnue. Le rapport conserve l'empreinte du binaire, la plage, la configuration des
API et chaque adresse d'appel. Ce lecteur reste source-neutre et ne contient aucun
identifiant propre à une œuvre.

## Conséquences

Le lecteur pourra être réutilisé par plusieurs titres partageant ces familles sans
ajouter de branche au runtime. La première image demande plus de preuves, notamment
pour TEV et les sémantiques d'animation, mais une capacité manquante échoue au niveau
de l'adaptateur au lieu d'être masquée par une approximation silencieuse.
