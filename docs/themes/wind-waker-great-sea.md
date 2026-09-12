# Thème Wind Waker — La Grande Mer vivante

## Statut

- Proposition de direction artistique, non acceptée et non générable.
- Aucun asset commercial n'est inclus dans ce dépôt.
- Les noms de ressources, coordonnées, musiques, acteurs et relations définitifs
  doivent venir de l'inventaire privé de la copie locale du jeu.
- ZeldaRET est une preuve d'implémentation publique. Noclip peut servir d'oracle
  visuel, jamais de source d'assets ni de runtime.

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

- [Décompilation Wind Waker de ZeldaRET](https://github.com/zeldaret/tww)
- [Implémentation publique du Lion Rouge](https://github.com/zeldaret/tww/blob/main/src/d/actor/d_a_ship.cpp)
- [Implémentation publique de la Grande Mer](https://github.com/zeldaret/tww/blob/main/src/d/actor/d_a_sea.cpp)
- [Extracteur Wind Waker de noclip.website](https://github.com/magcius/noclip.website/blob/main/src/ZeldaWindWaker/tools/zww_extractor.ts), référence de recherche uniquement
