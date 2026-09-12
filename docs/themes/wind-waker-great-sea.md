# Thème Wind Waker — La Grande Mer vivante

## Statut

- Direction artistique Grande Mer acceptée ; génération privée autorisée.
- Source retenue : édition GameCube PAL uniquement (`GZLP01`, révision 0).
- Passe d'audit locale du 12 septembre 2026 achevée ; l'inventaire et le repère J3D
  privés sont qualifiés, mais aucune activation n'a été réalisée.
- Aucun asset commercial n'est inclus dans ce dépôt.
- Les noms de ressources, coordonnées, musiques, acteurs et relations définitifs
  doivent venir de l'inventaire privé de la copie locale du jeu.
- ZeldaRET est une preuve d'implémentation publique. Noclip peut servir d'oracle
  visuel, jamais de source d'assets ni de runtime.
- Le concept machine privé vérifie 49 secteurs, 13 sous-systèmes et 38 ressources ou
  activités ; son gate retourne `generation_allowed: true` après le `go` utilisateur.

## Reçu d'entrée GameCube

Le RVZ local privé est identifié comme `THE LEGEND OF ZELDA The Wind Waker for
PAL`, disque 1, révision 0. Son SHA-256 de conteneur est
`5e305cfa4a554c94ea7cd012c86d40e808293a287f025a4486a452478f2a6f53`.
`nodtool 2.0.0-alpha.10` confirme un RVZ lossless, Zstandard niveau 19, blocs de
128 KiB et données de vérification présentes. La vérification Redump passe avec
CRC32 `61fc5423`, SHA-1 `98f0a19d9a3b2ca3352621c77f47a547c97a27f1` et XXH64
`bd3a241a857eda1b`.

La passe a utilisé uniquement des lectures virtuelles en mémoire :

- `nodtool 2.0.0-alpha.10`, binaire macOS arm64 vérifié par SHA-256
  `e23ca466999b720c55e6d29c9683fce8cc74451ba64ead2e543d50129f24528a` ;
- `decomp-toolkit 1.8.4`, binaire macOS arm64 vérifié par SHA-256
  `5ba1fd76adf937847277a1ebe2238b698df0020c3dbbde23ecb126f00fb10353` ;
- ZeldaRET à `e3c6c8143b92e948d17b0151b2311c54d1e64d25`, qui déclare et prend en
  charge explicitement la version PAL `GZLP01`.

Le système de fichiers contient 2 320 fichiers et 187 répertoires, pour
1 093 932 617 octets logiques. La première classification trouve notamment
1 339 archives RARC, 95 textures BTI, 58 banques de particules JPC, 67 banques
audio AW, 76 flux AFC, 235 modules REL, le manifeste audio AAF et l'archive de
séquences `JaiSeqs.arc`. Ces comptes qualifient la surface à fermer ; ils ne
constituent pas encore une conversion ni une fermeture de dépendances.

La Grande Mer est bien structurée en 49 rooms, plus `Room0` pour le fond marin.
`Room1.arc` à `Room49.arc` contiennent tous un placement `room.dzr` et une
collision `room.dzb`. Quarante-huit rooms portent directement au moins un BDL ;
la room 26, Tower of the Gods, ne contient que placement et collision et exige
donc de résoudre ses objets placés au lieu d'inventer un modèle manquant. Le
stage commun fournit séparément ciel, nuages, brume, faux horizon marin,
textures de nuages et liste d'événements. Les `LOD01.arc` à `LOD49.arc` et
`LODALL.arc` confirment une représentation distante distincte des rooms proches.

## Intention

Le wallpaper montre un voyage complet et continu sur la Grande Mer. Link navigue sur
le Lion Rouge ; il ne constitue jamais un objet flottant ou une simulation séparée.
Toutes les zones de la carte participent à une seule boucle fermée. Chaque île possède
une silhouette, une ambiance sonore et au moins une activité lisible qui la distingue
des autres secteurs.

Le thème adapte des comportements observés au rôle d'un wallpaper. Il ne prétend pas
reproduire l'IA originale du jeu.

## Invariants visuels et techniques

- `vessel.instance` possède le déplacement, la trajectoire et la session principale.
- Le bateau, Link, la tête du Lion Rouge, la voile, les accessoires et les effets
  forment un assemblage hiérarchique unique.
- Link utilise un attachement `rider` dérivé d'une table ou du code source. Aucun
  offset visuel estimé n'est accepté.
- La dernière portion de route rejoint la première avec continuité de position,
  tangente, vitesse, roulis, environnement, audio et phase de mer.
- La carte complète existe dans l'état logique. Seuls le secteur courant, les voisins
  nécessaires et les silhouettes distantes sont résidents à pleine qualité.
- Une pause ou une occlusion confirmée fige route, mer, vent, animation, audio,
  acteurs, particules et streaming. La reprise conserve exactement le même état.
- Chaque effet utilise les émetteurs et sockets réellement déclarés. Un émetteur
  absent n'est jamais remplacé par une copie symétrique.
- Une île sans piste musicale propre conserve la musique de navigation ou l'ambiance
  attestée par la source. La DA n'invente pas quarante-neuf chansons.
- Un acteur proposé dans le tableau reste `candidat` jusqu'à fermeture de ses modèles,
  animations, effets, audio, placement et comportement.

## Assemblage principal

```text
world-state
├── sector-stream
├── environment-state
├── cyclic-route
└── vessel.instance
    ├── boat.body
    ├── boat.head
    ├── boat.sail
    ├── boat.accessories
    ├── rider.socket → Link
    ├── wake.left
    ├── wake.right
    ├── spray.front
    └── browser.primary
```

La hauteur et la normale de la mer produisent le tangage et le roulis du bateau. Link
hérite d'abord de cette transformation, puis ajoute uniquement son animation locale.
Cette propriété interdit le double root motion et le glissement du personnage.

## Boucle mondiale

L'inventaire construit un graphe de secteurs depuis les rooms et placements de la
Grande Mer. Un solveur de route produit ensuite une boucle qui visite les quarante-neuf
secteurs au moins une fois, sans téléportation et sans imposer un ordre dans le runtime.
L'ordre final reste une donnée privée liée à la version du disque.

Chaque approche d'île comporte quatre phases :

1. `distant` : silhouette et signature atmosphérique ;
2. `approach` : préchargement, transition musicale et apparition de la faune ;
3. `feature` : cadrage lisible et événement ambiant propre au secteur ;
4. `departure` : extinction progressive de l'événement et retour à la navigation.

Une île reste cadrée assez longtemps pour être reconnue. Les événements ont plusieurs
variantes déterministes afin que les tours successifs ne donnent pas exactement la
même pose, sans modifier leur fréquence ni leur budget.

## Registre des secteurs et intentions

La colonne audio exprime une politique, pas encore un nom de fichier. `Locale` exige
une piste ou une règle de transition démontrée dans la source. `Grande Mer` conserve
le thème de navigation et ajoute seulement des sons spatiaux attestés.

| Secteur | Lieu, nom de travail anglais | Moment distinctif proposé | Audio | Acteur ou activité candidate |
| --- | --- | --- | --- | --- |
| A1 | Forsaken Fortress | Projecteurs balayant les murs et passage à distance | Locale sombre | Sentinelle volante ou faisceau de recherche |
| B1 | Star Island | Silhouette étoilée révélée par un léger virage caméra | Grande Mer | Petit vol circulaire d'oiseaux |
| C1 | Northern Fairy Island | Halo coloré montant depuis l'entrée | Grande Mer + signature féerique | Fée ou particules orbitantes confirmées |
| D1 | Gale Isle | Rafale visible qui incline voile et embruns | Locale si attestée | Nuages et spirale de vent |
| E1 | Crescent Moon Island | Reflet lunaire parcourant la côte | Grande Mer | Oiseaux ou lueur de trésor confirmée |
| F1 | Seven-Star Isles | Plusieurs silhouettes alignées comme une constellation | Grande Mer | Vol groupé d'oiseaux |
| G1 | Overlook Island | Contre-plongée courte sur les hauteurs | Grande Mer | Oiseau tournant autour du sommet |
| A2 | Four-Eye Reef | Canons et tours s'activant par vagues non agressives | Grande Mer + percussion locale | Défense du récif confirmée |
| B2 | Mother and Child Isles | Passage entre les deux masses avec parallaxe marquée | Grande Mer + signature féerique | Particules ou acteur local confirmé |
| C2 | Spectacle Island | Série de cibles animées au passage du bateau | Locale de mini-jeu si attestée | Cibles, plateforme et opérateur confirmé |
| D2 | Windfall Island | Moulin en rotation, habitants et mouettes en couches | Musique locale attestée | Habitants et oiseaux issus du secteur |
| E2 | Pawprint Isle | Lecture graphique de la forme puis activité dans les cavités | Grande Mer | ChuChu ou faune confirmée par placement |
| F2 | Dragon Roost Island | Vol autour du sommet, fumée et silhouettes Rito | Musique locale attestée | Rito ou Kargaroc confirmé |
| G2 | Flight Control Platform | Une silhouette plane au-dessus de la trajectoire | Locale de défi si attestée | Rito ou planeur source |
| A3 | Western Fairy Island | Halo chaud et petites orbites lumineuses | Grande Mer + signature féerique | Fée ou effet local confirmé |
| B3 | Rock Spire Isle | Navire marchand croisant le trajet à vitesse lente | Grande Mer + commerce si attesté | Navire marchand confirmé |
| C3 | Tingle Island | Tour lisible, sommet en mouvement et ballon éventuel | Locale si attestée | Acteurs de la tour confirmés |
| D3 | Northern Triangle Island | Faisceau bref reliant repère et ciel | Grande Mer | Repère lumineux source |
| E3 | Eastern Fairy Island | Halo froid et cercle de particules | Grande Mer + signature féerique | Fée ou effet local confirmé |
| F3 | Fire Mountain | Panache, lumière de lave et distorsion thermique | Locale tendue si attestée | Keese ou acteur volcanique confirmé |
| G3 | Star Belt Archipelago | Traversée oblique entre plusieurs rochers | Grande Mer | Oiseaux distribués sur plusieurs hauteurs |
| A4 | Three-Eye Reef | Défenses révélées successivement par le cadrage | Grande Mer + impacts lointains | Défense du récif confirmée |
| B4 | Greatfish Isle | Mer assombrie, pluie et silhouette brisée | Ambiance de l'état narratif retenu | Pluie, éclairs et faune réellement présente |
| C4 | Cyclops Reef | Un seul centre fort et rotation autour du récif | Grande Mer | Défense centrale confirmée |
| D4 | Six-Eye Reef | Lecture panoramique des six structures | Grande Mer | Séquence de canons bornée |
| E4 | Tower of the Gods | La tour domine l'horizon avec anneaux et reflets | Musique locale si attestée | Lumières, statues ou effets source |
| F4 | Eastern Triangle Island | Second motif triangulaire avec couleur distincte | Grande Mer | Repère lumineux source |
| G4 | Thorned Fairy Island | Silhouette épineuse puis halo intérieur | Grande Mer + signature féerique | Fée ou particules confirmées |
| A5 | Needle Rock Isle | Faisceau vertical ou événement au sommet | Grande Mer | Oiseau ou mécanisme confirmé |
| B5 | Islet of Steel | Masse métallique et activité défensive contenue | Grande Mer + métal/vent | Navire ou canons confirmés |
| C5 | Stone Watcher Island | Statue cadrée frontalement puis en profil | Grande Mer | Armos ou acteur de pierre confirmé |
| D5 | Southern Triangle Island | Troisième repère complétant le motif du tour | Grande Mer | Repère lumineux source |
| E5 | Private Oasis | Palmiers, cabane et eau beaucoup plus calme | Locale détendue si attestée | Mouettes ou petits acteurs locaux |
| F5 | Bomb Island | Petites fumées ponctuelles et relief creusé | Grande Mer | ChuChu ou effet explosif non combatif confirmé |
| G5 | Bird's Peak Rock | Essaim circulaire clairement visible autour des pics | Grande Mer + cris spatiaux | Oiseaux du puzzle confirmés |
| A6 | Diamond Steppe Island | Brume plus dense et silhouette à plusieurs niveaux | Grande Mer ou ambiance spéciale attestée | Peahat, navire spectral ou acteur confirmé |
| B6 | Five-Eye Reef | Défenses en quinconce et traversée latérale | Grande Mer | Défense du récif confirmée |
| C6 | Shark Island | Mécanismes de l'île animés dans leur ordre source | Locale de puzzle si attestée | Interrupteurs et effets électriques confirmés |
| D6 | Southern Fairy Island | Halo vert ou doré distinct des autres fontaines | Grande Mer + signature féerique | Fée ou particules confirmées |
| E6 | Ice Ring Isle | Brume froide, neige et réflexion bleutée | Locale froide si attestée | Keese de glace ou acteur confirmé |
| F6 | Forest Haven | Feuilles, spores et mouvements verticaux dans la canopée | Musique locale attestée | Korok, Peahat ou faune confirmée |
| G6 | Cliff Plateau Isles | Apparition successive des hauteurs et ponts naturels | Grande Mer | Peahat ou oiseaux confirmés |
| A7 | Horseshoe Island | Trajectoire épouse la courbe et révèle le parcours | Locale de défi si attestée | Noix, cibles ou acteurs du parcours |
| B7 | Outset Island | Village vivant, cochons et mouettes, lumière chaleureuse | Musique locale attestée | Habitants, cochons et oiseaux confirmés |
| C7 | Headstone Island | Vent plus grave autour de la stèle | Locale si attestée | Effets de vent et gardien confirmé |
| D7 | Two-Eye Reef | Passage court et symétrie très lisible | Grande Mer | Deux groupes défensifs confirmés |
| E7 | Angular Isles | Mouvement lent des blocs ou lecture du mécanisme | Grande Mer + mécanisme | Blocs et effets source |
| F7 | Boating Course | Bouées et cibles s'activent devant le bateau | Locale de mini-jeu si attestée | Cibles et opérateur confirmés |
| G7 | Five-Star Isles | Finale ample avec formation d'oiseaux avant le retour | Grande Mer, résolution avant reprise | Oiseaux ou grand acteur marin confirmé |

Les traductions et identités affichées seront remplacées par les libellés de la
version locale choisie lorsque son inventaire sera disponible.

## Musique et spatialisation

La musique suit une machine d'état liée aux secteurs :

- `travel` : musique de navigation ;
- `approach` : pré-transition sans redémarrer la piste à chaque frontière ;
- `local` : thème propre uniquement lorsqu'il est attesté ;
- `departure` : retour musical calé sur une frontière ou une enveloppe source ;
- `danger`, `weather` et `event` : couches temporaires seulement si elles existent.

Les vagues, le vent, la voile, les oiseaux, les machines et les habitants sont des
sources spatiales séparées. Le volume global du thème agit sur leur bus commun. Une
pause visuelle suspend aussi les nouveaux événements audio ; elle ne relance jamais
une piste depuis le début lors de la reprise.

## Population des îles

Chaque secteur doit fournir :

- une activité principale clairement lisible ;
- zéro à trois activités secondaires selon le budget source ;
- une zone d'apparition et une zone de retrait ;
- une fréquence maximale ;
- une graine déterministe ;
- une politique de LOD et d'occlusion ;
- une provenance vers le placement, l'acteur ou l'effet original.

Pour être qualifié d'intéressant, un secteur doit aussi posséder au moins trois
signatures vérifiées parmi les cinq axes suivants : silhouette, identité sonore,
acteur vivant, mouvement environnemental et mise en scène caméra. Deux secteurs
adjacents ne peuvent pas rejouer exactement la même combinaison d'événement, de
trajectoire d'acteur et de cadrage. Si le corpus ne permet pas de fermer ces preuves,
le secteur reste `non résolu` et bloque l'activation au lieu de recevoir du contenu
inventé.

Les oiseaux suivent des orbites irrégulières dérivées de points de contrôle et non un
cercle identique copié sur toutes les îles. Ils se posent, changent d'altitude ou
quittent momentanément le cadre lorsque les animations sources le permettent.

Les ennemis sont adaptés en présence ambiante : patrouille, vol, regard ou silhouette.
Ils n'attaquent pas le bureau et ne sont jamais décrits comme l'IA originale.

## Sessions et interactions

- Le bateau représente `browser.primary` et conserve son identité pendant toute la
  boucle.
- Les acteurs secondaires de session ne seront choisis qu'après inventaire. Les fées
  sont candidates, pas une dépendance imposée.
- Clic gauche : focaliser la session existante ou ouvrir celle déclarée par la cible.
- Clic droit sur une cible : personnaliser cette instance.
- Clic droit sur le vide : ajouter une représentation de session.
- Changer Link, le bateau, la voile ou un acteur ne change ni session, ni route, ni
  action.

## Objets épinglables

Les candidats sont l'assemblage bateau + Link, Link seul et les futurs acteurs de
session qualifiés. Le pin réutilise l'instance et la session ; il n'en crée pas une
copie. Son éditeur expose position, taille, luminosité et opacité, avec acceptation ou
annulation atomique et désactivation réversible.

Le pin natif macOS reste une capacité à implémenter et qualifier. La présence de son
bloc dans le manifeste ne constitue pas une preuve de fonctionnement.

## Menus automatiques

Les étapes sont générées depuis les axes réellement présents dans le catalogue :
personnage, apparence, embarcation, voile, environnement ou acteur de session. Un axe
vide n'apparaît pas. Une combinaison dépourvue d'attachement, de rig, de clips, de
textures, de preview ou d'action est exclue avec un diagnostic ; elle n'est jamais
remplacée silencieusement par le premier choix.

## Audit animation GameCube — passe lecture seule

Le dépôt sait aujourd’hui inventorier le placement GameCube et la structure J3D avec
des entrées bornées. Une fixture libre asymétrique qualifie le repère droitier Y-up,
l'ordre XYZ, les translations de joints et la conservation du winding vers le contrat
canonique. Le même lecteur passe sur le modèle principal de l'île de l'Aurore et le
corps du bateau. Les durées, pistes, matériaux, dépendances et raccords restent à
fermer avant toute génération rendable.

Le même adaptateur inventorie aussi les conteneurs RARC sans les extraire. Les 101
archives de la Grande Mer — fond marin, 49 rooms, 49 LOD, LOD global et stage commun —
passent le lecteur avec arbre, tailles, compression et empreintes contrôlés. Cette
couverture ferme l'enveloppe des secteurs, mais pas encore leurs dépendances vers les
archives d'acteurs et banques globales ; le gate de dépendances reste donc fermé.

Un essai isolé Blender 5.0.1 + J3DBlend a correctement révélé la structure générale,
mais il est rejeté comme convertisseur : extraction de textures indisponible sur
macOS, graphe de matériau incompatible, mesh signalé invalide et sémantique TEV non
qualifiée. Aucun GLB issu de cette voie ne devient un asset candidat.

Deux révisions publiques sont figées pour guider l’audit, sans fournir d’asset :

- ZeldaRET `e3c6c8143b92e948d17b0151b2311c54d1e64d25` pour les contrôleurs et acteurs ;
- noclip.website `6b16cfda00ef5af3ee2a66d8b928bb0bf700e5b6` comme implémentation de lecture et
  oracle visuel hors ligne.

L’implémentation J3D publique distingue au moins les pistes de joints `ANK1/ANF1`,
de transformation de texture `TTK1`, de registres couleur `TRK1`, de motif de texture
`TPT1` et de visibilité `VAF1`. Elles seront donc inventoriées comme familles séparées,
jamais aplaties dans un unique « clip de modèle ». Son contrôleur conserve un mode de
lecture, un début, une fin et un point de répétition distincts ; la borne de fin est
traitée explicitement plutôt que rejouée comme une pose ordinaire.

Le code public du Lion Rouge prouve aussi que le comportement doit être lu : certaines
animations de mât sont lancées avec un mode non bouclé, des actions sont franchies à
une frame précise, une transition inverse reprend la progression complémentaire, et
des callbacks modifient les matrices de joints du corps, de la tête, du canon et de la
grue. Ces opérations deviendront des lignes de relations et de transitions portant
symbole, révision et preuve ; elles ne seront pas recodées sous un nom Wind Waker dans
le runtime.

L'inventaire virtuel confirme les ressources nécessaires au premier assemblage :

- `Ship.arc` contient quatre modèles BDL et dix clips BCK pour le corps, la tête,
  le canon et la grue ;
- `LkAnm.arc` contient notamment `voyage1.bck`, `ship_jump1.bck` et
  `ship_jump2.bck`, avec leurs pistes matériau BTK/BTP associées ;
- `Kamome.arc` contient deux modèles, neuf clips BCK et cinq pistes sonores BAS ;
- `sea/Stage.arc` sépare ciel, nuages, brume, horizon, événements et textures ;
- les rooms de la mer séparent modèles BDL, animation texture BTK, placement DZR,
  collision DZB et textures/masques BTI lorsqu'ils existent.

Le placement de Link n'est plus une inconnue : `setShipRidePos` transforme
`l_ship_offset = {0, 15, -35}` par la matrice animée du corps du bateau. Deux offsets
source distincts existent pour l'usage d'objet (`{0, 15, -66.8}`) et le warp
(`{0, 15, -96}`). La navigation emploie `voyage1`; le saut et l'atterrissage
emploient respectivement `ship_jump1` et `ship_jump2`. Le mode de lecture vient de
l'attribut BCK transmis au contrôleur de frames : aucun nom de clip ne suffit pour
décider qu'il boucle.

La lecture bornée des trois BCK ferme maintenant leurs métadonnées brutes :
`voyage1` est une boucle de 40 frames, `ship_jump1` une pose statique one-shot de
durée zéro et `ship_jump2` un atterrissage one-shot de 15 frames. Les trois ciblent
42 joints. Le joint racine possède une translation Y animée dans `voyage1`, X/Y
dans `ship_jump2` et aucune piste de translation animée dans `ship_jump1` ; ces
canaux restent locaux au squelette tant que leur échantillonnage n'a pas prouvé une
autre propriété. Le contrat accepte donc explicitement les poses source de durée
zéro au lieu de fabriquer une frame ou une boucle.

Le contrôleur confirme la causalité du saut. En navigation normale, `voyage1`
réagit au vent, à la vitesse et à l'angle de barre. Le bateau n'arme le saut qu'en
mode voile, hors vol et hors contrôle forcé, avec une vitesse avant supérieure à
16,5 et une puissance de vent d'au moins 11 ; l'action dédiée déclenche ensuite
l'état `JUMP`. Cet état sélectionne `ship_jump1`. Le contact avec la hauteur d'eau
déclenche `LAND`, sélectionne `ship_jump2`, puis le contrôleur tient la fin tant que
le bateau vole ou revient vers `voyage1` une fois posé. Une simple oscillation de
la mer ne peut donc jamais devenir un saut.

Les effets du bateau sont eux aussi conditionnels et asymétriques. Le code source
arrête sillage, vagues et éclaboussures lorsque le bateau vole au-dessus de l'eau ou
n'avance plus. Les deux vagues apparaissent seulement au-delà des seuils de vitesse,
avec directions gauche/droite distinctes ; la trace de coque est un émetteur séparé
et l'impact d'atterrissage est borné par la vitesse verticale. Les ancres source de
chaque vague vont de `(-80, -50, -150)` à `(-40, -100, -350)`, puis le côté opposé
miroite uniquement la composante X. Ces données devront alimenter une relation
générique véhicule → socket → effet, pas des constantes Wind Waker dans le runtime.

La mouette n'est pas une simple orbite décorative : le contrôleur source combine
chemins de scène, cible 3D, vitesse progressive, tangage, roulis de virage, pose au
sol et transitions entre vol, déplacement, attente, chant, repas et atterrissage.
Le futur comportement wallpaper devra sélectionner un sous-ensemble attesté et
déterministe, sans remplacer cette structure par un cercle générique.

La suite de l’audit animation conserve cet ordre en lecture seule :

1. inventorier archives, modèles, squelettes et toutes les familles d’animation sans
   exporter de pixels ni de maillages ;
2. fermer modèle → squelette → animation → matériau et recenser les callbacks ;
3. rechercher pour chaque acteur sélectionné les tables puis les appels du contrôleur
   qui fixent mode, vitesse, bornes, mélanges, interruptions et marqueurs ;
4. écrire `orbite.animation-semantics/1` avec une ligne par clip et aucune boucle
   supposée ;
5. échantillonner les poses et états matériau aux bornes, mesurer chaque raccord et
   rejeter tout dépassement ;
6. comparer frame par frame l’oracle hors ligne et le candidat isolé, y compris après
   pause, reprise, transition et changement de secteur.

Pour Link sur le bateau, la route et le parent bateau possèdent le déplacement global.
Le clip de Link ne peut ajouter que les canaux locaux démontrés. La qualification
échoue si deux propriétaires appliquent la même translation/rotation, si un événement
est livré deux fois au wrap, ou si un clip ponctuel est transformé en boucle.

## Capacités génériques à ajouter

- graphe borné de cellules de scène et fenêtre de streaming ;
- état mondial sérialisable et reprise déterministe ;
- preuve de continuité d'une route cyclique ;
- surface procédurale multi-onde ;
- environnement temporel pour ciel, lumière, fog, vent et météo ;
- conversion J3D/GX/TEV suffisamment fidèle ;
- callbacks d'articulations et attachements dynamiques ;
- effets et audio spatiaux résolus ;
- pin natif macOS avec invalidation indépendante.

Aucune de ces capacités ne porte un nom Wind Waker dans le noyau ou le RenderHost.

## Qualification avant activation

La première activation est interdite tant que les preuves suivantes ne passent pas :

- inventaire et dépendances fermés pour les quarante-neuf secteurs ;
- visite de chaque secteur et fermeture continue de la boucle ;
- identité visuelle et audio distincte de chaque île ;
- Link correctement attaché sous toutes les orientations et hauteurs de vague ;
- voile, tête, gouvernail et accessoires cohérents avec les signaux ;
- sillage gauche, droit, avant et arrière aux origines attestées ;
- aucun pop visible pendant le streaming ;
- aucune couture de mer, de ciel, de lumière ou de musique ;
- aucune téléportation d'animation ou répétition d'effet au raccord ;
- identité des sessions conservée pendant un tour complet et les changements
  d'apparence ;
- pin, menus, reset, acceptation, annulation, pause et reprise qualifiés ;
- zéro nouvelle soumission de frame en pause ou sous occlusion confirmée ;
- scène témoin structurellement différente convertie sans modification du runtime.

## Références publiques de recherche

- [Lecteur de disque `nod` v2.0.0-alpha.10](https://github.com/encounter/nod/tree/v2.0.0-alpha.10)
- [VFS en mémoire de `decomp-toolkit` v1.8.4](https://github.com/encounter/decomp-toolkit/tree/v1.8.4)
- [Décompilation Wind Waker de ZeldaRET](https://github.com/zeldaret/tww/tree/e3c6c8143b92e948d17b0151b2311c54d1e64d25)
- [Contrôleur J3DFrameCtrl public](https://github.com/zeldaret/tww/blob/e3c6c8143b92e948d17b0151b2311c54d1e64d25/include/JSystem/J3DGraphAnimator/J3DAnimation.h)
- [Implémentation publique du Lion Rouge](https://github.com/zeldaret/tww/blob/e3c6c8143b92e948d17b0151b2311c54d1e64d25/src/d/actor/d_a_ship.cpp)
- [Implémentation publique de la Grande Mer](https://github.com/zeldaret/tww/blob/e3c6c8143b92e948d17b0151b2311c54d1e64d25/src/d/actor/d_a_sea.cpp)
- [Lecteur et échantillonneur J3D de noclip.website](https://github.com/magcius/noclip.website/blob/6b16cfda00ef5af3ee2a66d8b928bb0bf700e5b6/src/Common/JSYSTEM/J3D/J3DGraphAnimator.ts), référence de recherche uniquement
- [Extracteur Wind Waker de noclip.website](https://github.com/magcius/noclip.website/blob/6b16cfda00ef5af3ee2a66d8b928bb0bf700e5b6/src/ZeldaWindWaker/tools/zww_extractor.ts), référence de recherche uniquement
