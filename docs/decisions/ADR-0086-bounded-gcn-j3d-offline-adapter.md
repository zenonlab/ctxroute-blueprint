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
Une API peut déclarer un second registre d'argument. Le reçu conserve alors sa valeur
hexadécimale et, si elle pointe dans une section matérialisée, la chaîne ASCII bornée.
Cette preuve couvre aussi bien les surcharges archive/index que archive/nom sans
spécialiser l'analyseur pour une table de ressources donnée.

Les animations squelettiques peuvent porter une table sonore JAI/BAS après leur
section `ANK1`, et les mêmes tables existent comme fichiers autonomes. L'adaptateur
les traite comme une famille typée distincte : chaque événement conserve son
identifiant, sa fenêtre temporelle et ses paramètres de lecture. Un suffixe inconnu,
une taille incohérente, un pointeur sérialisé non nul, un flottant invalide ou un
bourrage non nul ferme la conversion au lieu d'être assimilé à du padding libre.

Les pistes matériau utilisent un lecteur commun mais quatre sorties typées, conformes
aux blocs chargés par J3D : `TTK1`, `TPT1`, `PAK1` et `TRK1`. Noms de matériaux,
identifiants résolus, slots texture ou TEV, centres SRT, cardinalités et valeurs de
lecture restent dans le reçu. Les tailles de section BTK historiques peuvent différer
du stockage aligné de moins de 32 octets ; l'adaptateur conserve les deux tailles,
borne cet écart et valide toutes les plages réellement référencées. Il reproduit aussi
le fallback du loader J3D qui transforme un type matriciel BTK inconnu en type `0`,
tout en conservant la valeur source pour l'audit.

Les textures BTI sont inventoriées dans leur représentation GX native avant tout
décodage. Le reçu garde format, mode alpha brut, échantillonnage, mipmaps, LOD,
anisotropie, palette et offsets. Les tailles de payload sont recalculées avec les
dimensions de tuiles GX puis comparées aux plages physiques ; une texture lisible ne
vaut toutefois pas encore qualification de son matériau TEV.
`mipmapEnabled` et `mipmapCount` restent deux propriétés indépendantes : la première
reproduit l'activation par JUTTexture, la seconde borne les niveaux physiquement
stockés. Une différence entre elles est conservée, pas réparée silencieusement.

Un payload GX sans en-tête n'est accepté qu'avec une relation source privée donnant
explicitement format, dimensions, sampler, mipmaps et palette. L'adaptateur réutilise
le calcul de tuiles BTI et exige que l'image puis la palette terminale déclarée
expliquent exactement le fichier. Le nom et la taille ne deviennent jamais une
preuve de disposition. Les tables binaires simples suivent la même règle : un lecteur
générique reçoit magic, compteur, endian, offset et taille des records, borne toutes
les plages et expose des empreintes sans interpréter les champs propres au jeu.

Une table BMT est lue comme une composition de sections optionnelles `MAT3` et
`TEX1`. L'adaptateur matérialise les remaps de matériaux et les bindings de slots,
réutilise exactement le lecteur BTI pour les textures embarquées et compte les
bindings qui restent externes. Le nombre de sections déclaré et le nombre réellement
stocké demeurent deux faits distincts : un fichier auto-borné peut être inventorié
avec `declaration_complete: false`, mais cet écart ne peut fermer une qualification.
Les indices MAT3 de culling, texgen, nombre de stages TEV, alpha compare, blend,
depth, emplacement du Z compare et dither sont conservés puis résolus selon le
factory J3D épinglé. Les sentinelles appliquent uniquement les valeurs par défaut
attestées ; une alpha compare absente reste absente. Chaque index, enum, booléen et
capacité GX est borné. Cette fermeture de l'état pixel fixe ne vaut pas fermeture du
fog ou de l'indirect texturing. Le combinateur TEV suit le même principe : il expose
par stage les ordres texture/raster, entrées couleur et alpha, opérations, bias,
scales, clamps, registres de sortie, sélections et couleurs konst, couleurs signées
et swaps. Les indices absents reproduisent strictement les constructeurs par défaut
J3D. Les domaines GX et la plage signée 10 bits sont vérifiés avant publication.
Le lecteur de modèle appelle ces mêmes parseurs sur ses sections MAT3 et TEX1 puis
contrôle chaque binding contre la table de textures embarquée. Une table `texNo`
absente n'est acceptée que si tous les slots source portent la sentinelle d'absence.
Le fog matérialise type, ajustement de portée, distances, couleur et table de dix
coefficients. Le bloc indirect conserve activation, ordres texture, échelles,
matrices 2×3, exposant et paramètres de chaque stage TEV. Il suit l'index logique du
matériau utilisé par le factory, indépendamment du remap des données d'initialisation.

La collision DZB reste une famille indépendante du mesh rendu. Son lecteur préserve
les six tables sources — sommets, triangles, blocs, arbre, groupes et propriétés —,
valide toutes leurs références et expose hiérarchie, transforms et bornes. Aucun code
runtime ne déduit une logique de jeu d'un bit de propriété non encore relié à son
contrôleur source.

## Conséquences

Le lecteur pourra être réutilisé par plusieurs titres partageant ces familles sans
ajouter de branche au runtime. La première image demande plus de preuves, notamment
pour TEV et les sémantiques d'animation, mais une capacité manquante échoue au niveau
de l'adaptateur au lieu d'être masquée par une approximation silencieuse.
