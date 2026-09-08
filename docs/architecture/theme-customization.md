# Architecture de personnalisation — scène, rigs et UI diégétique

État au 8 septembre 2026 : **frontière produit acceptée ; première tranche PoC2
implémentée, interactions natives encore à qualifier**.
Le PoC2 fournit un brouillon d'objet (nom, couleur, taille, application), une modale
sur clic droit, un ajout sur vide qualifié et une persistance locale après quittance.
Il ne réalise pas encore les imports, rigs ni skins d'UI décrits dans cette cible.
Le starter PoC2 remplace les libellés des contrôles par deux carrés 40×40,
espacés de 8 points, avec tracés natifs adaptés de Lucide 0.468.0 (`volume-x`,
`volume-2`, `monitor`, `eye`, `eye-off`), icônes 24×24 et licence embarquée. Le renderer et le hit-test
partagent la même géométrie ; ce changement visuel ne qualifie pas l'entrée macOS.
Le contrôle fichiers projette uniquement l'état relu par le connecteur : écran si
inconnu, œil si visible, œil barré si masqué. Le provider ne lit ni ne modifie les
préférences macOS. L'ouverture des Réglages demeure le fallback d'erreur.
Voir [ADR-0054](../decisions/ADR-0054-macos-theme-interaction.md).
Décision : [ADR-0050](../decisions/ADR-0050-theme-customization-and-local-assets.md).
Les contrôles système intégrés au thème sont précisés par
[ADR-0051](../decisions/ADR-0051-theme-system-control-shelf.md).
Le [flux Archify](src/theme-customization.dataflow.json) montre comment une création
partageable se combine à des ressources privées importées localement.

## Intention

L'apparence provisoire du PoC macOS ne définit pas le produit. Ses boutons AppKit sont
des commandes de diagnostic destinées à prouver le connecteur, pas un design à
conserver. L'expérience finale doit permettre à un thème d'harmoniser décor, objets,
personnages, menus, transitions, sons et terminal avec le langage du jeu choisi.

La personnalisation est donc une couche produit autonome, placée au-dessus des
connecteurs OS et en dessous des créations. Elle doit rester ouverte aux scènes 2D,
3D, hybrides et aux moteurs particuliers, sans introduire une branche `if game == …`
dans le cœur.

## Les trois plans à ne pas mélanger

| Plan | Fonction | Exemple | Personnalisation |
| --- | --- | --- | --- |
| Connecteur natif | installation, permissions, erreurs, choix d'écran, récupération | app macOS AppKit | sobre, accessible, cohérent avec l'OS |
| UI du thème | menus, boutons, panneaux, HUD, sélecteur de sessions | menu inspiré d'un jeu | totalement stylisable dans le contrat du thème |
| Scène | décor, objets, personnages, animations, effets | karts, boutique, carte 2D | ressources et comportements composables |

Un réglage TCC ou une erreur de provider ne doit pas être peint sur un kart. Inversement,
le bouton « ouvrir la session » du thème ne doit pas être figé comme un bouton AppKit
générique. Une seule source d'état relie ces présentations.

## Modèle de ressources ouvert

Le pipeline d'import accepte des familles de ressources, pas une liste fermée de jeux :

- scènes, nœuds, maillages, sous-maillages et niveaux 2D ;
- squelettes, skins, poses de référence, contraintes et clips d'animation ;
- matériaux, textures, vertex colors, sprites, atlas et effets ;
- collisions, volumes de clic, chemins, cartes et points d'ancrage ;
- polices, glyphes, icônes, curseurs, cadres nine-slice et sons d'interface ;
- musique, ambiances et métadonnées de boucle ;
- métadonnées de provenance, dépendances et compatibilité.

Les formats d'échange seront choisis par capacité. glTF/GLB, KTX2, PNG/WebP et les
formats audio ouverts restent des candidats utiles, pas une obligation pour les
archives canoniques. Un adaptateur peut conserver une donnée source propriétaire puis
produire une vue optimisée pour le runtime. La conversion ne détruit jamais la source
privée préservée.

## Importation d'objets 3D et de rigs

Un objet importé ne se réduit pas à un mesh. Son enregistrement canonique sépare :

- la hiérarchie de nœuds et les transformations locales ;
- le maillage et ses primitives ;
- le squelette, la pose de liaison et les poids de skin ;
- les clips et leurs événements ;
- les matériaux et textures ;
- les collisions et volumes interactifs ;
- les rôles sémantiques proposés puis confirmés ;
- la provenance et la version du lecteur.

La compatibilité d'un rig est explicite. Une `skeleton_signature` décrit les os, leur
parenté et la bind pose. Une animation est `native`, `retargeted`, `approximated` ou
`incompatible`. Le retargeting produit une table d'os et un rapport de pertes ; un nom
d'os ressemblant ne suffit jamais à déclarer la compatibilité.

Les objets instanciés reçoivent des identités stables indépendantes de leur ressource.
Quatre karts peuvent partager un modèle tout en conservant quatre sessions, états,
couleurs et trajectoires distincts.

## UI entièrement stylisable, sémantique stable

Le thème peut modifier : palette, typographie, textures, formes, bordures, neuf zones,
icônes, sons, transitions, profondeur, disposition, caméra et réactions. Il peut fournir
des composants comme boutons, listes, onglets, panneaux, jauges, dialogues, champs et
sélecteurs de sessions.

La peau ne remplace pas la sémantique. Un bouton reste une action avec libellé, états
`default/hover/pressed/focus/disabled/busy`, ordre de navigation et nom accessible.
Une texture de menu importée sert de fond ou de nine-slice ; les zones actives et le
texte restent des composants réels. Cette structure permet le clavier, la manette,
l'IME, l'accessibilité et les fallbacks natifs.

Le système de style comporte trois niveaux :

1. tokens sémantiques (`surface`, `text`, `accent`, espacements, typographie, motion) ;
2. recettes de composants reliant tokens et ressources visuelles ;
3. compositions de panneaux positionnant les composants et leurs liaisons.

Les valeurs peuvent être fournies par code ou par un futur studio. Le format ne dépend
pas de l'outil d'édition. Le contrat UI générique du blueprint n'est pas le thème du
produit ; il sert seulement de garde initial pour l'interface de développement.

## Étagère de contrôles système

Chaque thème dispose d'une région sémantique `system_controls`. Sa position par défaut
est le coin supérieur gauche dans une safe area tenant compte de l'écran, de l'échelle
et des éléments système. Le thème peut changer son apparence, sa disposition, son
animation, son état replié et même sa position. Il ne recode pas le comportement des
capacités standard.

La présentation par défaut expose seulement deux boutons : `theme.audio.muted`
et `desktop.items.visible`. Les autres capacités restent dans le panneau contextuel
de personnalisation, pas sur une seconde barre de diagnostics. Les gestes suivent
[le contrat d'interaction](theme-interactions.md).
Le catalogue des capacités, distinct de leur présentation, comprend :

| Contrôle | Portée | Garantie |
| --- | --- | --- |
| `theme.audio.muted` | sons et musique du thème | portable, sans modifier le volume des autres apps |
| `theme.motion.paused` | animations et simulations du thème | portable ; l'UI reste réveillable |
| `theme.interaction.locked` | ancres et actions diégétiques | portable ; la récupération native reste accessible |
| `theme.performance.profile` | économie, équilibré ou qualité | portable selon les profils réellement fournis |
| `theme.overlay.visible` | panneaux et informations du thème | portable si un overlay est déclaré |
| `desktop.items.visible` | fichiers/icônes gérés par le shell du bureau | capacité OS optionnelle et réversible |
| `theme.settings.open` | panneau de réglages du thème | portable ; présentation adaptée au connecteur |

Le mute standard concerne uniquement l'audio produit par le thème. Le volume maître
du système est une action différente, intrusive pour les autres applications, et
n'entre pas dans ce socle. Elle ne pourra être ajoutée que comme capacité explicite
avec consentement et retour d'état propres à chaque OS.

### État confirmé, jamais optimiste

Une action suit `requested → pending → applied | rejected | unsupported | unknown`.
Le bouton ne change son état final qu'après une quittance portant l'identifiant de la
requête et la valeur relue. Une modification externe invalide l'affichage puis publie
le nouvel état lorsque le connecteur sait l'observer. Timeout, redémarrage de Finder
ou d'Explorer et changement de session ne valent jamais succès.

`desktop.items.visible` ne s'exécute ni à l'installation, ni au chargement du thème,
ni parce qu'une IA l'a placé dans une recette. Seule une action utilisateur confirmée
peut le modifier. La préférence appartient à l'utilisateur et non au thème ; changer
de thème ne la réinitialise pas. L'app connecteur conserve un contrôle natif de
récupération indépendant du rendu pour rendre les éléments visibles si le thème ou
son entrée échoue.

### Contrat pour les auteurs et l'IA

Le starter de thème instancie `system_controls` dès la création, au lieu de greffer
des boutons après le design. Le générateur reçoit le catalogue de capacités, leurs
états, leurs fallbacks et les composants sémantiques obligatoires avant d'écrire la
scène. Le validateur signale une étagère hors écran, illisible, masquée sans autre
chemin ou liée à une commande native brute.

L'auteur garde le dernier mot : il peut réorganiser, remplacer la représentation ou
déclarer un retrait explicite. Ce retrait est visible dans le manifeste et dans la
review ; il ne peut pas être produit silencieusement par omission. Les thèmes officiels
conservent l'accès à audio, mouvement, verrouillage, profil énergétique et réglages,
sans imposer leur présence permanente dans le coin de l'écran.

## Symbiose avec un jeu sans fusion des contenus

Un package partageable contient notre logique et des slots, par exemple :

- `vehicle.player`: modèle animé compatible avec un rig ou une animation déclarée ;
- `ui.session_card`: portrait, cadre, police et états d'activité ;
- `track.navigation`: chemin de course et formation ;
- `action.open_session`: intention contrôlée ;
- `effect.recovery`: animation de récupération, telle qu'un rôle de type Lakitu.

La bibliothèque privée de l'utilisateur résout ces slots vers les ressources extraites
localement. Le package ne contient ni ROM, ni modèle, texture, police, son ou code du
jeu. Il peut contenir des assets originaux ou libres comme fallback. Une recette
exportée conserve références logiques, contraintes et créations propres au projet,
jamais les fichiers privés résolus.

Une IA peut rechercher un lecteur public, proposer des rôles, générer un adaptateur ou
préparer une table de retargeting hors ligne. Ses résultats passent les mêmes schémas,
tests et validations ; aucune décision du modèle n'entre directement dans le runtime.

## Contrat de composition proposé

Le manifeste canonique est organisé par domaines stables :

| Domaine | Responsabilité |
| --- | --- |
| `assets` | ressources originales distribuables et références privées par identifiant |
| `slots` | exigences de type, rig, matériau, animation, collision ou UI |
| `scene` | instances, hiérarchie, caméra, éclairage et couches |
| `ui` | tokens, composants, panneaux, navigation et accessibilité |
| `bindings` | événements, conditions, actions, cibles et résultats |
| `system_controls` | placement, style, ordre et présentation des capacités standard |
| `capabilities` | fonctions requises, optionnelles et fallbacks |
| `profiles` | budgets de rendu, animation, audio et qualité |
| `provenance` | auteur, licences, versions, outils et contenu exportable |

Ce découpage prépare l'import et le design sans figer le schéma JSON final. Les
identifiants sont portables ; les handles GPU, chemins absolus et types AppKit restent
hors du manifeste.

## Sécurité et permissions

- import local explicite, jamais au chargement silencieux d'un thème ;
- lecteurs et convertisseurs hors du runtime permanent ;
- validation de taille, compte, profondeur, références et chemins avant décodage ;
- dérivés en cache reconstructible ; sources privées dans la bibliothèque utilisateur ;
- shaders, scripts et actions séparés des données, avec capacités et quotas ;
- aucune commande système déduite du nom ou de l'apparence d'un objet ;
- diagnostic sans contenu de terminal, nom de fichier privé ou miniature non autorisée.

## Sobriété par composition

La liberté visuelle n'autorise pas l'activation de tous les sous-systèmes. Le
compilateur de thème produit un plan d'exécution minimal : pas de squelette si aucun
skin n'est visible, pas de physique si un chemin précalculé suffit, pas de passe 3D
pour un menu 2D, pas de mise à jour d'un panneau fermé et aucune frame sans invalidation
pour une scène statique.

Chaque ressource annonce mémoire estimée, fréquence de mise à jour et fallback. Les
budgets sont mesurés sur la composition réelle ; « 2D », « vidéo » ou « 3D » ne
constituent pas à eux seuls un classement énergétique.

## Ordre des preuves

1. terminer la frontière du connecteur macOS avec une fixture originale minimale ;
2. figer le premier schéma de slots et d'identités sans choisir le renderer général ;
3. conduire [D1 — preuve de design et import](../pocs/theme-design-poc.md) avec un objet
   original riggé, une UI stylée et leurs fallbacks ;
4. comparer les hôtes de rendu sur cette tranche, pas sur un triangle ;
5. brancher ensuite les états synthétiques de sessions ;
6. éprouver un adaptateur de jeu local seulement après ces contrats.

Le connecteur macOS et D1 partagent le manifeste et les tests de contrat. Ils ne
partagent pas leurs types d'UI ou leur cycle de vie natif.

## Validation documentaire

Le dataflow Archify passe le profil `showcase` avec 9 contrôles sur 9, sans erreur
ni avertissement. Le contrôle visuel passe à 1440×900, 1600×1000, 1920×1080 et
2048×1320 en clair et sombre. Les captures sombres 1440×900 et 2048×1320 ont été inspectées : étapes,
branches publique/privée et sorties de présentation sont lisibles sans collision.
Source SHA-256 :
`411d2117c6c0c37915a5b20aa681bb99ec2e6605b332dbed96b97558c49caee0`.
Artefact SHA-256 :
`11dddffbc223fc7dc9590091628449d2cf2c7d8bbea4f7989ec9f002d9182a30`.
Le modèle de gestes réside dans la composition du thème ; ce repère de responsabilité
ne signifie pas que le raccord natif ou le courtier d'actions est livré.
Les libellés sont en français ; l'interface fixe du viewer reste en anglais.
