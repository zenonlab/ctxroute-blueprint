# Recherche — prochain PoC « jeu complet → thème soigné »

État au 9 septembre 2026 : **recherche primaire terminée ; Bevy retenu pour le
PoC ; première indexation G1 reproductible exécutée**.

## Verdict

Le prochain PoC doit combiner deux preuves sans les confondre :

1. **G1 — couverture d'un jeu complet** : chaque ressource et relation de la
   version épinglée est inventoriée, classée, reliée ou déclarée inconnue ;
2. **D1 — thème de qualité produit** : une composition réellement utilisable
   résout une petite partie de cette bibliothèque et ne charge que ses dépendances.

« Jeu complet » ne signifie pas exécuter tout le jeu derrière le bureau ni prétendre
avoir automatiquement porté chaque mécanique. Cela signifie qu'aucun fichier du
corpus n'échappe silencieusement à l'index et que la couverture est mesurable par
catégorie. Le runtime reste sélectif.

## Corpus de référence

### Choix : Majora's Mask N64 NTSC-U 1.0

La ROM locale fournie a été vérifiée le 9 septembre 2026 : identifiant `NZSE`,
révision 00 et SHA-1 `d6133ace5afaa0882cf214cf88daba39e266c078`. Ce hash correspond
à la version NTSC-U 1.0 reconnue par 2Ship2Harkinian. La décompilation `zeldaret/mm`
ne supporte actuellement que la version N64 US et documente une chaîne qui
décompresse la ROM, extrait les fichiers, archives, assets, textes et audio.

Sources primaires :

- [dépôt et installation `zeldaret/mm`](https://github.com/zeldaret/mm/blob/main/README.md) ;
- [processus d'extraction du Makefile](https://github.com/zeldaret/mm/blob/main/Makefile) ;
- [hashes reconnus par 2Ship2Harkinian](https://github.com/HarbourMasters/2ship2harkinian/blob/develop/docs/supportedHashes.json) ;
- [construction et extraction privée de 2Ship2Harkinian](https://github.com/HarbourMasters/2ship2harkinian/blob/develop/docs/BUILDING.md) ;
- [documentation des objets et données non interprétées](https://github.com/zeldaret/mm/blob/main/docs/tutorial/object_decomp.md).

Les XML d'objets exposent notamment squelettes, animations, textures, collisions,
display lists et animations de textures. La documentation avertit aussi que certains
blocs restent non référencés ou non interprétés : G1 doit les compter comme inconnus
au lieu de les masquer.

### Ce corpus prouve — et ne prouve pas

Il permet de valider l'indexation complète d'une ROM réelle, les scènes/rooms,
formats 2D/3D, rigs, collisions, relations XML, temps et acteurs documentés.
Il ne démontre pas qu'une ROM commerciale inconnue devient automatiquement
convertible. Un futur jeu propriétaire utilisera un autre adaptateur derrière les
mêmes contrats de bibliothèque et de composition.

Aucun asset Majora's Mask n'est ajouté au dépôt produit. G1 consomme la ROM et un
checkout local épinglé ; le package partageable conserve uniquement recettes,
identifiants, paramètres et provenance. Les sorties contenant des assets restent privées.

## La logique temporelle à conserver comme connaissance

Le thème doit distinguer les données extraites des comportements adaptés. Les horaires,
trajectoires, états d'acteurs et conditions documentés sont conservés dans la
bibliothèque. D1 compile un cycle ambiant déterministe : horloge contrôlée, états du
jour, trajectoires planifiées et transitions réversibles. Il ne porte pas la boucle
de jeu complète, les combats ou l'ensemble des scripts d'acteurs.

La qualification relie chaque comportement adapté à ses données sources sans le
nommer « logique originale exacte ». Cette distinction autorise une fidélité future
plus grande sans changer le contrat du thème.

## Socle de rendu : Bevy retenu pour le PoC

### Godot

Godot importe correctement glTF et peut exécuter des scripts headless, ce qui le rend
utile comme outil de conversion ou visualiseur. Son mode d'intégration de jeu dans
l'éditeur conserve cependant le jeu dans un **processus séparé**. Il ne fournit pas
la primitive requise pour rendre directement dans la `CAMetalLayer` possédée par le
provider du wallpaper. Il n'est donc pas le runtime du connecteur :
[commande headless](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html),
[import glTF](https://docs.godotengine.org/en/4.5/tutorials/assets_pipeline/importing_3d_scenes/import_configuration.html) et
[game embedding](https://docs.godotengine.org/en/latest/tutorials/editor/game_embedding.html).

### Bevy

Bevy résout scènes glTF, skins, animations, graphes d'animation, extras et picking.
Ses fonctionnalités sont modulaires par Cargo, et son mode `Reactive` permet une
boucle basse consommation. Mais son intégration standard installe `WinitPlugin` et
un runner de fenêtre ; `RenderPlugin` possède un sous-app de rendu. Brancher ces
systèmes sur une surface créée et possédée par notre provider exige donc un prototype,
pas une hypothèse : [exemples glTF/animation](https://github.com/bevyengine/bevy/blob/main/examples/README.md),
[DefaultPlugins](https://docs.rs/bevy/latest/bevy/struct.DefaultPlugins.html),
[WinitSettings](https://docs.rs/bevy/latest/bevy/winit/struct.WinitSettings.html) et
[RenderPlugin](https://docs.rs/bevy_render/latest/bevy_render/struct.RenderPlugin.html).

Bevy est retenu par décision produit pour le prochain PoC. Il est distribué sous
`MIT OR Apache-2.0`, apporte ECS, scènes, glTF, animation, UI et rendu wgpu. Son mode
réactif constitue une primitive utile, mais pas une preuve énergétique :
[configuration officielle](https://github.com/bevyengine/bevy/blob/main/Cargo.toml) et
[`WinitSettings`](https://docs.rs/bevy/latest/bevy/winit/struct.WinitSettings.html).

Le risque restant est l'hôte natif. L'intégration standard de Bevy utilise winit ;
notre provider possède déjà sa `CAMetalLayer`. Le PoC doit donc conserver `RenderHost`,
prouver le rendu Bevy dans cette couche et refuser toute validation obtenue seulement
dans une fenêtre ordinaire. wgpu sait cibler directement une `CAMetalLayer`, ce qui
fournit le chemin technique sous-jacent :
[`SurfaceTargetUnsafe::CoreAnimationLayer`](https://docs.rs/wgpu/latest/x86_64-apple-darwin/wgpu/enum.SurfaceTargetUnsafe.html).

## Formats de travail

- glTF/GLB reste le format de livraison géométrique, pas la base canonique ni un
  langage de gameplay. La spécification courante reste glTF 2.0 :
  [registre Khronos](https://registry.khronos.org/glTF/).
- KTX2/Basis Universal est un dérivé candidat pour les textures GPU ; le cache doit
  conserver les paramètres d'encodage et rester reconstructible :
  [spécification KTX 2.0](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html).
- L'index complet est un SQLite local, transactionnel pendant l'ingestion puis fermé
  et ouvert en lecture seule par les outils. Les gros contenus restent dans un CAS
  de blobs ; ils ne sont pas placés dans la base. Le runtime ne consulte ni WAL ni
  index mutable : [contraintes WAL SQLite](https://www.sqlite.org/wal.html).
- Les comportements usuels du thème commencent par un graphe déclaratif typé.
  WebAssembly reste une extension ultérieure pour du code tiers complexe. WIT décrit
  l'interface mais pas le comportement ; Wasmtime exige limites mémoire et interruption
  explicites, et ne préempte pas une fonction hôte bloquée :
  [WIT](https://component-model.bytecodealliance.org/design/wit.html),
  [`Store` et limites Wasmtime](https://docs.rs/wasmtime/latest/wasmtime/struct.Store.html).

## Architecture du prochain PoC

Le travail est ordonné pour produire une preuve utile même si le renderer final reste
ouvert :

1. épingler les révisions `zeldaret/mm`, ZAPD et outils, puis vérifier la ROM ;
2. extraire et indexer la totalité du corpus dans SQLite + CAS avec hashes et relations ;
3. produire un rapport par catégorie : découvert, interprété, lié, inconnu, erreur ;
4. compiler un premier thème privé avec Bourg-Clocher et ses dépendances transitives ;
5. exécuter le cycle temporel adapté et les interactions sans terminal ;
6. rendre le pack avec Bevy dans une fenêtre de référence puis sur `CAMetalLayer` ;
7. intégrer Bevy au connecteur macOS sans déplacer la logique du thème ;
8. mesurer énergie incrémentale, mémoire, temps de chargement, frames et qualité.

Le changement de zone ou d'acteur doit réutiliser l'index existant sans rescanner le
jeu. La suppression d'un asset local doit devenir une dépendance manquante explicite,
jamais une texture noire ou un crash.

## Gates avant implémentation large

La [première exécution G1](../pocs/game-library-g1-results.md) ferme déjà
l'inventaire, le CAS/SQLite et la répétabilité physique. Elle ne ferme pas les
relations sémantiques profondes, l'export de recette ni le second adaptateur.

| Gate | Preuve exigée |
| --- | --- |
| G1-A | 100 % des chemins du corpus épinglé comptabilisés ; aucune catégorie ignorée silencieusement |
| G1-B | toutes les références de Bourg-Clocher résolues ou qualifiées ; sortie déterministe sur deux passes |
| G1-C | package partageable inspecté : aucun asset, chemin absolu ou contenu privé |
| D1-A | horloge, états et trajectoires d'acteurs restent déterministes pendant pause, reprise et changement de phase |
| D1-B | clic gauche, clic droit, menu, Son/Fichiers et animation utilisent les mêmes identités sémantiques |
| R1 | Bevy reçoit le même pack et la même séquence d'événements en fenêtre puis sur la vraie `CAMetalLayer` |
| R2 | mesures répétées `N ≥ 5` face au bureau natif ; résultat conservé même s'il contredit l'hypothèse favorite |

Une interface qui fonctionne seulement dans une fenêtre de démonstration ne valide
pas R1. Un beau screenshot ne valide ni G1, ni les relations, ni l'énergie.

## Décision préparée

Commencer par l'indexeur et le compilateur de thème, indépendants du renderer. Ensuite
seulement, raccorder Bevy au provider réel. Cela produit immédiatement
une bibliothèque de jeu réutilisable et empêche un moteur graphique de contaminer le
format du produit.
