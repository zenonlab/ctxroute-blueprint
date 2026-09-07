# Cas concret : OoT vers un environnement interactif

Étude du 7 septembre 2026. Lecture de sources publiques épinglées, sans clone,
installation, exécution d'extracteur ni accès à une ROM. Les chemins ci-dessous
désignent les dépôts amont, pas des fichiers de jeu présents ici.
Voir [ADR-0040](../decisions/ADR-0040-source-engine-and-theme-runtime.md).

## Verdict et périmètre

**Le moteur d'origine conditionne la récupération ; il n'est pas obligatoire de
le faire tourner pour rendre ses objets interactifs dans notre thème.**
Pour OoT, les sources décrivent scènes, collisions, acteurs, squelettes et
animations. Elles montrent aussi que des comportements dépendent du joueur,
des flags et des cinématiques. Extraire les données n'extrait donc pas un moteur
interactif autonome. Notre composition peut leur associer ses propres règles.
Sources : [commandes de scène][scene-cmd], [collisions][collision],
[acteur de l'épée][sword].

Choix de travail réversible : **Ocarina of Time, Temple du Temps (`tokinoma`)**.
La table déclare `SCENE_TEMPLE_OF_TIME` et `SDC_TEMPLE_OF_TIME` ; le descripteur
comprend une scène et deux rooms. La scène n'est donc ni un unique mesh ni un
matériau trivial présumé. [Table des scènes][scene-table], [XML du Temple][temple].

Version de référence documentaire : `ntsc-1.0`, explicitement listée par le
[README zeldaret][oot-readme]. La version réellement fournie par l'utilisateur
reste inconnue ; on ne demandera pas une autre ROM pour satisfaire cet exemple.
Maison de Link (`link_home`) est le repli de complexité, pas une seconde chaîne
à construire simultanément. Le choix du pilote ne crée aucune exception OoT dans
le runtime commun et ne certifie aucun jeu/version.

## Dépôts et fonctions réellement vérifiés

Révisions observées via API GitHub ; fichiers ciblés lus via raw.githubusercontent.com.
Les pages GitHub épinglées ont échoué dans le lecteur web, mais les contenus raw
ont répondu HTTP 200. Ce n'est ni une compilation ni un audit exhaustif des dépôts.

| Dépôt et révision | Preuve consultée | Utilisation proposée / limite |
| --- | --- | --- |
| [zeldaret/oot][oot-root] `cbe814b25455f14a343a7457c4b1c92af40ede6a` | README, Makefile, extracteur Python, XML, code collision/acteur/minimap | Source prioritaire de données, relations et compréhension. Le projet reconstruit le jeu ; il n'annonce pas être un port PC ou un exporteur de thème. |
| [zeldaret/ZAPD][zapd] `35ea376daf003fdd3297a2e7355ad82e70ec1e8c` | README : mode `e`, XML et segments, sorties C/H optionnelles | Outil distinct utile selon chaîne/version ; **pas** l'extracteur à attribuer automatiquement au HEAD OoT étudié. API GitHub : MIT. |
| [Fast-64/fast64][fast-root] `44b7bd9603382f1ac7c0d1c1c5f1b3abe3008405` | Guide z64 et brouillons glTF | Inspection/import Blender et aide à normaliser ; pas un runtime desktop ni une conversion universelle. API GitHub : GPL-3.0. |
| [HarbourMasters/Shipwright][ship-root] `97f4fd5925596a493e7cd4f45b4f5fb34400a9db` | README, `.gitmodules`, tree | Référence de réutilisation des ressources dans un port. Pas le fond d'écran retenu : lancer le port conserve le jeu actif. |
| [HarbourMasters/Torch][torch] `106621f0f0f9731b8739bec95227c2c5887492df` | README : processeur d'assets, modes `otr` et `code` | Alternative à étudier si elle réduit la normalisation. Ce HEAD n'est pas le gitlink Shipwright : celui-ci fixe `2ab12fe9660aec04e02ee89fe81baed304a1a1d6`. API GitHub : MIT. |

Les licences repérées sont des signaux d'inventaire, pas une autorisation globale
sur les jeux. L'API ne fournissait pas de licence SPDX globale pour OoT/Shipwright.
Certains fichiers d'extraction OoT portent CC0-1.0 ; les outils audio déclarent
plusieurs licences. Vérifier chaque composant réutilisé et sa distribution,
sans recopier le code du jeu dans notre recette publique. [Extracteur][extract-main],
[documentation audio][audio].

### Deux corrections au chemin historique

Le [Makefile OoT][makefile] invoque aujourd'hui `python -m tools.assets.extract`,
avec des handlers Python pour display lists, collision, squelettes et commandes
de scène. La liste [write_source.txt][write-source] inclut les C de `tokinoma`
et `link_home`. « ZAPD → GLB directement » n'est pas une chaîne vérifiée.

Shipwright référence **Torch** dans ses [sous-modules][submodules]. Son README
décrit des assets `.o2r`, tout en conservant des mentions OTR pour certains
parcours/mods. Il ne faut pas reprendre un ancien nom d'archive comme contrat
de notre produit ni mélanger librement les révisions du port et de Torch.

## Matrice des ressources et comportements

« Décrit » signifie observé dans les sources, **pas extrait avec succès ici**.

| Élément | Preuve et limite | Traitement dans notre environnement |
| --- | --- | --- |
| Scène / rooms | XML `tokinoma_scene`, `tokinoma_room_0`, `tokinoma_room_1` ; config de dessin spécifique [source][temple] | Conserver hiérarchie, variante de scène et ressources partagées ; pas de fusion automatique de tout le niveau. |
| Placements et paramètres | Commandes pour acteur, entrée joueur, objets, chemins, headers alternatifs [source][scene-cmd] | Résoudre identité, transformation et variante ; distinguer instance placée et banque de modèles. Une entrée acteur ne contient pas tout son comportement. |
| Collisions | Handler de `CollisionHeader`, `SurfaceType`, `WaterBox` [source][collision] | Conserver mesh et attributs séparés. Proxy de clic autorisé ; il ne prouve ni sol navigable, ni marche, ni saut original. |
| Squelette / animation | XML adulte `gLinkAdultSkel` Flex/LOD ; import squelette et animation documenté par Fast64 [XML][link-model], [guide][fast-guide] | Sélectionner les dépendances du clip, vérifier pose, LOD et variantes de membres. Modèle et animation ne donnent pas le contrôleur du joueur. |
| Matériaux et effets | Fast64 signale des commandes Gfx dynamiques non importées et des différences de normales/cycle [guide][fast-guide] | Qualifier chaque effet : traduit, adapté, absent. `unlit` seul ne prouve pas une fidélité N64 exacte. |
| Interaction avec l'épée | L'acteur consulte `gSaveContext`, `PlayState`, parent joueur et cinématiques [source][sword] | Pour ouvrir notre panneau : nouvelle liaison de thème. Pour reproduire le retrait original : portage borné de dépendances, non automatique. |
| Marche / saut | Le fichier joueur expose une logique dédiée et de nombreuses références d'animations [source][player] | Animation de marche, déplacement ambiant et gameplay fidèle sont trois capacités distinctes. Le contrôleur original n'est pas inclus dans un GLB. |
| Audio | Outils de banques, échantillons et désassemblage de séquences [source][audio] | Une séquence musicale n'est pas une piste PCM prête à boucler. Synthèse/rendu hors ligne et frontière de boucle restent à valider ; ne pas annoncer que vgmstream suffit. |
| Minimap / PNG | Code reliant scène/room, textures, échelles et offsets de boussole [source][map] | Reprendre les relations comprises, pas une association par noms de PNG ou reconnaissance visuelle obligatoire. Pas de minimap native présumée pour le Temple. |

Les extensions N64 proposées dans le [document glTF Fast64][fast-gltf] sont
marquées Draft, avec absence d'implémentation connue dans ce document. Cela ne
prouve pas que tout export Blender est impossible ; cela interdit de promettre
que ses matériaux spécifiques seront rejoués fidèlement par un lecteur glTF
standard. Le passage Blender → représentation runtime reste une intégration
à éprouver, avec restitution et métadonnées latérales explicitement vérifiées.

## Chaîne proposée et code restant

Chemin prioritaire à éprouver, pas une chaîne installée :

1. Identifier localement version et empreinte de l'entrée, sans publication de
   ROM, capture ou dump. Révision d'outil figée, dossier privé distinct du dépôt.
2. Préparer les dépendances publiques puis exécuter hors réseau les étapes de
   décompression/segmentation et extraction compatibles. Ne pas lancer
   aveuglément `make setup` : il installe aussi des dépendances Python et compile
   des outils. La séparation installation/traitement privé reste à réaliser.
3. Conserver les sorties comprises avec leurs liens et leur provenance. Le CLI
   Python observé accepte segments décompressés, sortie, `-v`, `-s` et `-r` ;
   le filtre exact et les dépendances d'une scène sont à confirmer par exécution,
   pas par une commande inventée. [CLI][extract-cli], [Makefile][makefile].
4. Évaluer Fast64/Blender comme outil hors ligne de lecture et contrôle. Vérifier
   la compatibilité avec les C réellement générés par cette révision OoT.
   Ne pas installer Blender dans le runtime ni recréer son éditeur.
5. Écrire seulement le pont manquant : références stables, conversion de repères,
   sélection des variantes, représentation visuelle choisie et métadonnées de
   collision/placements/capacités. Aucun convertisseur universel ex nihilo.
6. Résoudre notre recette : objet sélectionné → panneau → bouton → effet ou
   animation → retour UI. Le runtime ne charge que la composition préparée ;
   aucun ROM, lecteur, Blender, Torch ou jeu en tâche de fond.

Répartition technique de travail : Python candidat pour l'adaptateur proche des
outils OoT/Blender ; leurs outils C/C++ restent des dépendances hors ligne.
Rust et wgpu restent candidats pour le contrôle/rendu ciblé ; la brique UI doit
couvrir le panneau, pas seulement dessiner un modèle. Aucun nouvel argument ici
n'impose Godot, Shipwright comme runtime ou une WebView pour le wallpaper.
Les versions et bibliothèques exécutables restent soumises aux prérequis E1.

Le moteur d'origine guide **l'adaptateur**, pas les types du contrat commun.
Un comportement original réutilisé doit avoir ses dépendances identifiées ; un
comportement réécrit doit être marqué adapté. Une fonction absente reste absente,
elle n'est pas certifiée par la réussite d'un import visuel.

## Tranche réelle et preuves manquantes

Ne pas refaire les outils communautaires pour « prouver qu'OoT existe ».
Réutiliser leurs preuves de structure, puis tester seulement nos raccordements.
L'étude du jeu est autorisée maintenant ; elle n'avance pas l'implémentation
optionnelle E6 avant les preuves desktop/énergie E2.

| Preuve ciblée | Sortie exigée | État actuel |
| --- | --- | --- |
| V1 — Entrée et scène | Version locale identifiée, scène et variante choisies | Aucun chemin ROM fourni ; `ntsc-1.0` reste hypothèse documentaire |
| V2 — Extraction | Journal local, liste des ressources/relations, absence de réseau, outil et commandes reproduisibles | Sources inspectées seulement |
| V3 — Normalisation | Room affichable, textures/couleurs vérifiées, collision séparée, liens et repères préservés | Pont et export non exécutés |
| V4 — Animation | Un modèle et un clip cohérents ; placement provenant de la scène ou explicitement créé par la recette | Non exécuté ; ne pas déclarer Link placé d'origine sans preuve |
| V5 — Interaction du thème | Ancre sur géométrie réelle → panneau → bouton → effet/animation → état UI | Parcours I01 spécifié, pas implémenté |
| V6 — Autonomie / énergie | Convertisseur fermé, aucune boucle du jeu ; entrées natives préservées et delta énergétique mesuré | MAC-01 est un diagnostic matériel, pas cette preuve |

Pour l'ancre initiale, utiliser une région de géométrie identifiée à V3 ; ne pas
garantir dès maintenant que l'épée ou une porte sera un objet isolé dans la room.
Un effet créé par notre thème doit être présenté comme tel, pas comme un mécanisme
original extrait. Le test d'un squelette est distinct de l'ouverture d'un panneau.

Audio fidèle, contrôle marche/saut original et minimap ne bloquent pas cette
première tranche. Pour la minimap, `Map_Init` cite explicitement la Forêt Kokiri :
étudier ensuite cette scène pour la relation monde/carte, plutôt qu'inventer une
carte native du Temple. Une carte générée par nous serait une autre capacité.

### Prochaine action exécutable

Terminer E1 sur MAC-01 (budget, mesure, stack expérimentale, sécurité et tests),
puis produire la tranche synthétique E2 équivalente à V5 avant adoption du rendu.
Pour passer de cette étude à une extraction réelle, l'utilisateur doit fournir
**un chemin local vers sa ROM et sa version si connue**, sans l'envoyer à un
service distant. Aucun accès aux autres dossiers privés n'a été recherché ici.
Installer/exécuter une chaîne privée exige aussi une isolation réellement
qualifiée ; le README amont seul n'est pas un reçu de sandbox.

### Limite de la recherche

Arrêt après vérification ciblée des voies d'extraction, des pertes de matériaux,
du couplage comportemental et des relations minimap. Pas d'inventaire exhaustif,
de comparaison énergétique, d'audit juridique ni de promesse multi-jeux.
Le résultat est une chaîne candidate traçable et ses lacunes, pas un bundle produit.

[oot-root]: https://github.com/zeldaret/oot/tree/cbe814b25455f14a343a7457c4b1c92af40ede6a
[oot-readme]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/README.md
[makefile]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/Makefile#L871
[extract-main]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/tools/assets/extract/__main__.py
[extract-cli]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/tools/assets/extract/extract_xml_z64.py#L325
[write-source]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/tools/assets/extract/write_source.txt
[temple]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/assets/xml/scenes/indoors/tokinoma.xml
[scene-table]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/include/tables/scene_table.h
[scene-cmd]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/tools/assets/extract/extase_oot64/scene_commands_resource.py
[collision]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/tools/assets/extract/extase_oot64/collision_resources.py
[link-model]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/assets/xml/objects/object_link_boy.xml
[sword]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/src/overlays/actors/ovl_Bg_Toki_Swd/z_bg_toki_swd.c
[player]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/src/overlays/actors/ovl_player_actor/z_player.c
[audio]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/tools/audio/README.md
[map]: https://github.com/zeldaret/oot/blob/cbe814b25455f14a343a7457c4b1c92af40ede6a/src/code/z_map_exp.c
[zapd]: https://github.com/zeldaret/ZAPD/tree/35ea376daf003fdd3297a2e7355ad82e70ec1e8c
[fast-root]: https://github.com/Fast-64/fast64/tree/44b7bd9603382f1ac7c0d1c1c5f1b3abe3008405
[fast-guide]: https://github.com/Fast-64/fast64/blob/44b7bd9603382f1ac7c0d1c1c5f1b3abe3008405/fast64_internal/z64/README.md
[fast-gltf]: https://github.com/Fast-64/fast64/blob/44b7bd9603382f1ac7c0d1c1c5f1b3abe3008405/fast64_internal/f3d/glTF/README.md
[ship-root]: https://github.com/HarbourMasters/Shipwright/tree/97f4fd5925596a493e7cd4f45b4f5fb34400a9db
[submodules]: https://github.com/HarbourMasters/Shipwright/blob/97f4fd5925596a493e7cd4f45b4f5fb34400a9db/.gitmodules
[torch]: https://github.com/HarbourMasters/Torch/tree/106621f0f0f9731b8739bec95227c2c5887492df
