# Recherche initiale — archive de synthèse

Source : texte fourni par l'utilisateur dans la conversation du 7 septembre 2026,
intitulé « Architecture Système d'un Moteur de Fond d'Écran Interactif Diégétique
et Pipeline Universel d'Ingestion d'Assets ROM ».

Ce document en conserve une synthèse structurée, pas une transcription verbatim.
Les blocs de code et tableaux originaux restent dans la conversation source.
Les références de forme `[cite: n]` n'étaient pas accompagnées de bibliographie
résoluble. Les affirmations ci-dessous sont des propositions de cette recherche,
non une validation indépendante. Elles ne doivent pas servir de spécification
exécutable sans vérification des sources et essais.

## Intention d'origine

Un fond d'écran 3D diégétique permettrait de cliquer sur des objets du décor
pour déclencher des actions du système, avec une empreinte réduite.
Une ingestion hors ligne extrairait les assets des ROM/images disque,
afin de ne pas conserver d'émulateur actif au runtime.

## Pipeline proposé

1. Lire statiquement des images `.z64`, `.iso`, `.bin/.cue` ou `.gcm`.
2. Cartographier les fichiers et décompresser Yaz0, MIO0 ou LZSS ; parcourir
   notamment RARC et ISO 9660 selon le support.
3. Traduire géométrie, display lists F3DEX2 ou commandes graphiques, textures,
   transformations, squelettes et collisions vers des représentations communes.
4. Décoder ADPCM, VAG ou DSP ADPCM en PCM, puis exporter l'audio et les boucles.
5. Produire un bundle `.scene` contenant `scene.glb`, `metadata.json` et `audio/`.
6. Charger la scène au runtime, transférer la géométrie au GPU et préparer le
   picking ; ancrer la surface au bureau et réguler le rendu selon l'activité.

Le conteneur envisagé était un répertoire ou un ZIP en mode Store, avec mmap
comme piste d'optimisation. Le chargement direct et les contraintes d'alignement,
de validation et d'accès aux données resteraient à démontrer.

## Intégration OS proposée

| Système | Pistes citées dans la recherche | Vérifications à reprendre |
| --- | --- | --- |
| Windows | Progman, message `0x052C`, WorkerW, `SetParent`, `WH_MOUSE_LL`, `WindowFromPoint`, `LVM_HITTEST` | Stabilité selon versions, échanges avec Explorer, coordonnées, focus et coût des callbacks. |
| Linux Wayland | `wlr-layer-shell`, couche BACKGROUND, ancrage aux quatre bords, pointeur natif | Support réel par compositeur et coexistence avec bureaux et icônes. |
| GNOME | Extension Gjs/Clutter, `_backgroundGroup`, texture DMA-BUF ; piste GtkPlain/GdkCustomSurface | APIs disponibles, maintenance, partage graphique et interaction réellement réalisables. |
| Linux X11 | Fenêtre DESKTOP ou pixmap racine, `XLowerWindow`, XInput2 | Gestionnaire de bureau, empilement et interférences avec ses icônes. |
| macOS | NSWindow sans bordure, niveau desktop, CAMetalLayer, `CGEventTap` passif | Niveau visible, Spaces, écrans, filtrage des clics et permissions exactes sur les versions ciblées. |

Ne pas recopier les exemples d'injection et d'input comme du code validé.
La compatibilité multiplateforme désirée n'est pas une preuve que ces voies
fonctionnent uniformément ou offrent les mêmes interactions.

## Rendu et sélection proposés

La recherche comparait un ID buffer GPU `R32_UINT`, lu via staging et lecture
asynchrone, au raycasting CPU dans une BVH avec parry3d. Elle préférait le CPU
sur des proxys ou maillages interactifs, avec une passe GPU ponctuelle sous le
curseur pour les géométries complexes ou animées.

Elle proposait une déprojection du curseur par inversion vue/projection.
Les conventions de profondeur, coordonnées écran et division homogène devront
être précisées et testées avant toute implémentation. Les affirmations de coût
logarithmique, de précision et de temps constant très faible sont à mesurer
sur les scènes, animations et occultations effectivement supportées.

## Régulation et objectifs initiaux

L'automate proposé comportait trois régimes : suspension sous occlusion totale,
veille à 1 FPS après trois secondes sans interaction pour les scènes statiques,
puis régime actif à 30/60/144 FPS selon activité ou animations.
Les animations continues, l'audio et le retour au bureau doivent être spécifiés
ensemble. La consommation du terminal et des agents n'était pas incluse.

| Chiffre de la recherche | Statut dans le projet |
| --- | --- |
| Ingestion inférieure à 30 secondes | Hypothèse sans jeu, taille et machine de référence. |
| Initialisation inférieure à 500 ms | Objectif exploratoire non mesuré. |
| CPU global inférieur à 1–2 % | Budget à redéfinir et protocole de mesure à établir. |
| Interaction inférieure à 16 ms | Cible exploratoire, dépendante du pacing et des OS. |
| Raycast de 0,02 à 0,05 ms | Affirmation à vérifier sur une scène représentative. |
| GPU strictement nul en suspension, veille inférieure à 0,1 % | Ne constitue pas une garantie du compositeur ou du système. |

## Format et comportements envisagés

GLB/glTF 2.0 devait conserver les nœuds indépendants et nommés, les vertex colors
`COLOR_0`, les matériaux `KHR_materials_unlit`, les attributs `JOINTS_0` et
`WEIGHTS_0`, les skins et matrices inverses. L'animation UV utilisait comme piste
`KHR_texture_transform` et des pointeurs d'animation ; le support des extensions
d'animation par les outils et le runtime restait à vérifier.

Le manifeste d'exemple comportait version, identifiant de bundle, nom, auteur,
caméras fixes avec parallaxe souris ou trajectoires cinématiques, ancres sur des
nœuds, déclencheur clic, curseur, feedback de survol et pistes audio.
Les actions illustraient `xdg-open` vers une URL et `alacritty -e htop`.
Ces exemples spécifiques à un environnement ne fixent pas l'interface
multiplateforme. Aucun schéma JSON formel de bundle n'est adopté ici.

## Audio proposé

La piste conservait une introduction puis une boucle, avec `LOOPSTART`,
`LOOPLENGTH` ou `LOOPEND` dans les commentaires Vorbis et/ou le manifeste.
cpal et symphonia étaient proposés pour la sortie et le décodage ;
vgmstream-cli pour l'extraction. La recherche suggérait seek et tampon circulaire.
La précision du seek, les unités trames/échantillons, le rééchantillonnage et
l'absence de discontinuité sonore doivent être validés ; un tag de boucle
ne démontre pas à lui seul un bouclage exact.

## Extracteurs et adaptateurs proposés

Trois voies étaient comparées : captures graphiques (Dolphin, GLideN64,
apitrace, RenderDoc), extracteurs de décompilations (SM64, ZAPD/Ship of Harkinian,
OpenGOAL), et parseurs de formats (SuperBMD, Fast64, BrawlCrate, DiscUtils).
La préférence allait aux extracteurs et parseurs préservant les hiérarchies,
rigs et animations. Les capacités de chacun et leur couverture réelle par titre
doivent être revérifiées ; aucune extraction n'a été effectuée dans ce dépôt.

Le contrat CLI imaginé était :

```text
adapter-engine --mode <inspect|extract> --input <rom> --output <directory> [--config <json>]
```

`inspect` émettait un JSON indiquant support, plateforme, titre et scènes.
`extract` émettait des événements JSON Lines de progression, assets créés et
fin ; les erreurs allaient sur stderr. Codes proposés : 0 succès, 10 format
incompatible, 11 corruption/décompression, 12 bundle non conforme.
Ce contrat est une archive de proposition, pas une interface publique du projet.

## Automatisation IA envisagée

Un agent analyserait signatures, endianness, tables d'offsets et entropie par
blocs de 4 Ko, aidé de documentation, en-têtes C ou Kaitai Struct. Il produirait
du Python/Rust avec pygltflib, numpy, trimesh et vgmstream-cli, testé dans Docker
ou Wasmtime, puis corrigé à partir de traces et dumps ciblés.

Une seconde étape produirait des vues de sous-maillages et utiliserait un modèle
multimodal pour suggérer noms sémantiques et associations d'actions.
La réussite d'un validateur structurel ne prouve ni fidélité ni identification
correcte. Les suggestions d'actions restent à configurer par l'utilisateur.
Cette automatisation n'est pas un prérequis du premier prototype.

## Stack et roadmap d'origine

Pistes : Rust, wgpu, winit/raw-window-handle, smithay-client-toolkit, cpal,
symphonia, parry3d, vgmstream-cli, Python et Kaitai Struct. La recherche
les comparait notamment à C++ et Vulkan direct/ash. Ses affirmations générales
sur sécurité mémoire, deadlocks, fuites, coût énergétique et réduction de code
restent à examiner ; le choix d'un langage ne valide pas ces propriétés.

La roadmap proposait : injection OS (semaines 1–3), bundle/picking (4–6),
audio/énergie (7–9), extracteur pilote (10–12), SDK et IA (13–16).
Le MVP annoncé à la troisième phase concernait le fond d'écran initial.
Ce planning est conservé pour mémoire ; il n'intègre pas le terminal et ne
constitue pas un engagement actuel.

## Évolution confirmée après cette recherche

L'utilisateur veut aussi un terminal personnalisé, avec des sessions affichées
comme des joueurs, par exemple en haut à droite dans un thème Mario Kart.
Il confirme les sessions de terminaux et d'agents, une fusion intéressante mais
modulaire, les trois OS, les personnages interchangeables, l'isolation des
éléments du jeu et la réutilisation maximale de l'existant.

La [vision produit actuelle](../00-project-brief.md) est la source de décision.
La [prochaine session](../session-handoff.md) doit discuter technologies et
infrastructure à partir de ce nouveau périmètre.
