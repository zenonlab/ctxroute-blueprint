# G1/D1 — jeu complet indexé et premier thème soigné

État au 9 septembre 2026 : **indexeur G1 et harnais de chargement implémentés ;
export visuel privé rejeté, relations sémantiques et raccord 3D wallpaper non terminés**.
Cette preuve commence sur le contrat stabilisé du
[PoC connecteur macOS](macos-connector-poc2.md). Elle suit
[ADR-0058](../decisions/ADR-0058-complete-game-poc.md) et la
[recherche de stack](../research/complete-game-theme-poc.md).
Les mesures et limites observées sont consignées dans les
[résultats G1](game-library-g1-results.md).

## Question

Peut-on inventorier un vrai jeu complet, compiler plusieurs compositions depuis la
même bibliothèque, puis livrer un thème cohérent mêlant ville, acteurs riggés,
animations, menu stylisé et interactions, sans exécuter le jeu ni redistribuer ses
assets et avec un runtime mesurable ?

## Corpus et composition

Le corpus G1 est **Majora's Mask N64 NTSC-U 1.0**, SHA-1
`d6133ace5afaa0882cf214cf88daba39e266c078`. L'index couvre la ROM, les fichiers
extraits, scènes, rooms, acteurs, objets, textures, matériaux, rigs, animations,
audio, collisions, overlays, messages, horaires et relations. Chaque entrée est
comptée même si son format reste inconnu.

La composition D1 contient :

- le sud de Bourg-Clocher (`Z2_CLOCKTOWER`) résolu depuis la bibliothèque locale
  avec plusieurs acteurs riggés, puis sélection des quatre autres zones extérieures ;
- un sélecteur capable de choisir une autre zone/variation sans réingestion ;
- un cycle temporel déterministe et des trajectoires de PNJ adaptées ;
- un panneau de sessions alimenté par des états synthétiques, avec bouton, liste,
  focus clavier et états d'activité ;
- une étagère `system_controls` en haut à gauche par défaut, repliable et restylée
  dans le langage visuel du thème ;
- une animation déclenchée par le panneau et un événement de fin renvoyé à l'UI ;
- un fallback 2D pour la ressource 3D absente.

Aucun asset du jeu n'est commité avec le produit ou inclus dans la recette partageable.
Des fixtures originales minimales restent utilisées dans les tests automatisés pour
ne pas rendre le checkout tiers obligatoire en CI.

## Visualiseur de pack de référence

`pocs/game-theme-viewer` fige une frontière exécutable minimale : Bevy 0.19.1 reçoit
un répertoire contenant `theme.json` et des GLB, valide la version, les références et
les chemins, puis instancie décor, personnages et objets avec leurs transformations
et clips déclarés. Le code ne contient aucun identifiant Zelda64 et ne connaît pas
Blender ou Fast64. La caméra vient du pack ; orbite, zoom et reset sont événementiels.
Voir [ADR-0062](../decisions/ADR-0062-data-driven-bevy-scene-pack.md).

Ce visualiseur ne prend actuellement en charge que le profil `gltf.standard`. Les
assets N64 convertis vers ce profil doivent être marqués `diagnostic` et la fenêtre
l'affiche explicitement. La prochaine preuve ajoute un profil source qualifié par un
oracle Fast3D/RDP, conformément à
[ADR-0063](../decisions/ADR-0063-source-render-profiles-and-oracles.md).

Cette preuve est volontairement une fenêtre de référence. Elle ne ferme D1-19
qu'après exécution sur le pack privé puis raccord du même pack à la vraie
`CAMetalLayer` du provider macOS.

Exécution observée sur MAC-01 : backend Metal sélectionné sur Apple M1 Pro, pack
chargé sans avertissement d'attribut après réduction à `COLOR_0` et caméra orbitale
opérationnelle. La revue humaine rejette cependant le résultat : les textures sont
mal associées et la fenêtre n'est pas le runtime wallpaper. Le binaire debug mesure
134 MiB avec symboles et
le graphe de dépendances reste important ; aucune conclusion de taille ou d'énergie
production n'en est tirée avant build release et protocole répété. Voir ADR-0061.

## Variantes comparées

1. indexation complète du corpus épinglé puis seconde passe sans changement ;
2. compilation d'une piste avec fermeture transitive de ses dépendances ;
3. sélection d'une autre zone et d'acteurs sans rescanner le corpus ;
4. ressource, référence ou rig incompatible avec diagnostic et fallback ;
5. rendu Bevy du pack dans une fenêtre de référence puis sur la vraie `CAMetalLayer` ;
6. thème statique, animation active, occlusion et panneau fermé pour mesurer
   l'invalidation et le coût incrémental.

## Critères G1 — jeu complet

| ID | Résultat requis |
| --- | --- |
| G1-01 | révisions du code, des données et des outils, hashes et inventaire de licences enregistrés |
| G1-02 | 100 % des chemins du corpus comptabilisés comme compris, partiels, inconnus ou exclus avec motif |
| G1-03 | index SQLite reproductible et blobs dédupliqués par contenu ; aucun gros asset stocké dans la base |
| G1-04 | relations scène → rooms → acteurs → objets → matériaux → textures → audio inspectables dans les deux sens |
| G1-05 | rigs, animations, collisions, graphes et logique sont des catégories distinctes ; aucune capacité inférée du seul mesh |
| G1-06 | deux indexations identiques produisent le même manifeste logique et aucun accès réseau pendant la lecture privée |
| G1-07 | compilation d'une piste résout toutes ses dépendances ou échoue avec la liste exacte des références manquantes |
| G1-08 | changer de zone/acteur réutilise la bibliothèque sans réingestion globale |
| G1-09 | recette partageable contrôlée : aucun asset tiers, blob privé, chemin absolu ou contenu de session |
| G1-10 | un second adaptateur fixture prouve que le schéma commun ne contient aucun identifiant Zelda64 |

## Critères

| ID | Résultat requis |
| --- | --- |
| D1-01 | hiérarchie, bind pose, poids et deux clips conservés après import |
| D1-02 | quatre instances partagent la ressource sans partager leur état |
| D1-03 | menu visuellement stylé, mais actionnable au clavier et avec focus visible |
| D1-04 | bouton → animation → événement final → état UI sans polling par frame |
| D1-05 | rig incompatible refusé ou retargeté avec rapport explicite |
| D1-06 | export de recette sans asset privé, chemin absolu ou contenu de session |
| D1-07 | remplacement du renderer sans modifier la recette ou les identités |
| D1-08 | scène statique sans timer ; systèmes invisibles suspendus |
| D1-09 | décompte mémoire, frames et énergie incrémentale documenté |
| D1-10 | rendu et menu forment une composition unique, sans panneau diagnostic du connecteur |
| D1-11 | audio, motion, interactions et profil énergétique agissent dans le runtime sans commande OS brute |
| D1-12 | contrôle desktop simulé suit pending/quittance/refus et ne ment jamais sur son état |
| D1-13 | étagère déplacée/restylée reste dans la safe area et accessible ; retrait exige une déclaration explicite |
| D1-14 | clic gauche lance uniquement l'association approuvée ; clic droit personnalise sans lancement |
| D1-15 | clic droit dans le vide ajoute ; annulation sans mutation ; cible native/inconnue jamais interceptée |
| D1-16 | seulement mute et fichiers visibles par défaut ; options avancées accessibles par personnalisation |
| D1-17 | le cycle temporel et les trajectoires d'acteurs sont déterministes, suspendables et réversibles |
| D1-18 | changement de zone/acteur ne modifie ni les identités de sessions ni les associations approuvées |
| D1-19 | Bevy rend le même pack et reçoit les mêmes événements en fenêtre puis sur `CAMetalLayer` |
| D1-20 | la qualification Bevy est motivée par mesures répétées, couverture visuelle et code restant, pas par préférence |
| D1-21 | la modale remplace deux variantes compatibles de personnage/véhicule et un canal de couleur sans changer l'identité, la session ou la trajectoire de l'instance |
| D1-22 | une variante incompatible est refusée avec diagnostic ; un thème sans `appearance_set` n'affiche aucun contrôle d'apparence vide |
| D1-23 | les rigs `fixed`, `orbit` et `rail` utilisent le même contrat, respectent leurs bornes et restaurent le preset du thème |
| D1-24 | la fin du contrôle caméra supprime ses invalidations ; mouvements réduits, pause et occlusion arrêtent la progression attendue |
| D1-25 | une seconde fixture 2D prouve que variantes de sprite et `parallax_2d` utilisent la même modale sans dépendance au jeu ou à l'émulateur source |
| D1-26 | huit instances bouclent sur un circuit 3D avec raccord continu, places stables et une seule autorité de transformation |
| D1-27 | le directeur caméra maintient les ancres du groupe dans la safe area pendant les virages sans téléportation ni correction de trajectoire |
| D1-28 | mêmes seed, événements et pas produisent les mêmes snapshots ; suspension/reprise n'entraîne ni rattrapage illimité ni rafale d'actions |

## Hors périmètre

Pas d'éditeur grand public complet, marketplace, génération IA en runtime, conversion
de ROM autre que l'entrée locale autorisée, terminal PTY, port bit-à-bit de toute la simulation Zelda64 ou
certification multi-OS. Le corpus complet est indexé ; seule la composition utile est
matérialisée et exécutée.

## Sortie

G1 livre une bibliothèque de jeu inspectable et réutilisable. D1 livre un thème
visuellement présentable, un pack compilé indépendant du backend et un verdict de
renderer sur macOS. Il ne choisit pas la stack du terminal ni le mécanisme wallpaper
des autres OS.
