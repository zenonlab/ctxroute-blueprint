# Architecture de personnalisation — scène, rigs et UI diégétique

État au 9 septembre 2026 : **frontière produit, apparences et rigs caméra acceptés ;
première tranche PoC2 implémentée, interactions natives encore à qualifier**.
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
Les variantes d'apparence et les caméras normalisées sont fixées par
[ADR-0064](../decisions/ADR-0064-source-neutral-appearance-and-camera-rigs.md).
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

## Apparence des personnages et objets

Le runtime ne connaît ni Mario Kart, ni Zelda, ni une console. Après conversion, il
manipule un `appearance_set` optionnel rattaché à un slot ou à une instance. Cet
ensemble décrit uniquement des variantes compatibles et les paramètres que l'auteur
autorise à personnaliser :

- `resource_variant` remplace un personnage, véhicule, sprite ou objet par une autre
  ressource déclarée compatible ;
- `material_variant` sélectionne une tenue, texture, livrée ou palette préparée ;
- `color_channel` expose des canaux sémantiques bornés tels que `primary`, `secondary`,
  `accent` ou `emissive`, accompagnés de leur masque de matériau ;
- `animation_set` associe les clips nécessaires au rôle sans changer l'identité de
  l'instance.

La modale de clic droit ne présente que ces possibilités déclarées. Un thème sans
personnage n'affiche aucun sélecteur de personnage. Un thème 2D peut proposer des
variantes de sprite ou d'atlas ; un thème 3D peut proposer modèles, skins et matériaux.
Changer l'apparence ne change jamais `instance_id`, `session_binding`, ordre de
formation, trajectoire ou travail terminal en cours.

Le manifeste d'interface v3 peut ordonner plusieurs étapes de galerie et relier deux
étapes par un attribut de compatibilité. Par exemple, une première ressource expose
`class=light` et la galerie suivante ne montre que les ressources portant la même
valeur. Ces identifiants sont opaques pour le connecteur : le même mécanisme convient
à une classe de poids, un rig, un biome ou toute autre compatibilité préparée par un
adaptateur. La session reste un lien secondaire et ne devient jamais une étape
d'apparence.

La version 4 matérialise `resource_variant` sans connaissance du jeu dans Swift :
le package associe un choix à un GLB privé digesté, une pièce sémantique et les indices
de clips correspondant aux slots de cette pièce. Le RenderHost effectue la substitution
par instance et restaure le modèle original au reset. L'identité de session, le chemin
et l'action restent portés par l'instance, jamais par le modèle.

La version 5 retire les deux dernières catégories connues du connecteur. `kind` est
un identifiant opaque déclaré par le thème et chaque étape devient une section de
menu AppKit construite automatiquement dans l'ordre du manifeste. Les overrides v2
conservent une table `selections` par catégorie ; les anciens champs `character` et
`vehicle` sont migrés à la lecture. Une nouvelle catégorie telle que `outfit`,
`companion`, `scene` ou `palette` ne demande donc aucune modification Swift. Chaque
catégorie de choix doit apparaître exactement une fois dans les étapes, ce qui évite
les choix chargés mais inaccessibles dans le menu.

La capacité optionnelle `pinning` expose les cibles 3D que le package autorise à
maintenir visibles devant les fenêtres ordinaires de l'espace de travail. Un pin est
une présentation supplémentaire de la même instance : il conserve `instance_id`,
`session_binding`, état et action. Le connecteur ne clone donc ni objet ni session.
Il exclut les écrans verrouillés, surfaces de sécurité et fenêtres système que la
plateforme interdit de recouvrir.

Le bouton pin bascule la visibilité persistante de la cible. Un clic droit sur le pin
ouvre un cadre de transformation distinct du menu d'apparence : déplacement et taille
dans le cadre, puis barres de luminosité et d'opacité. `accept` applique le brouillon
en une transaction ; `cancel` restaure le snapshot complet ; `disable` masque le pin
sans effacer ses réglages. Les réglages listent aussi les pins désactivés afin de les
réactiver. Les bornes viennent du manifeste et le connecteur refuse une cible absente,
une identité différente ou une capacité de fenêtre non disponible.

Une substitution riggée exige une `compatibility_signature` qui couvre le type de
ressource, le squelette, les clips requis et les points d'ancrage. Le runtime refuse
une substitution incompatible. Un retargeting n'est accepté que comme dérivé produit
hors ligne, accompagné de sa table et de son niveau de fidélité. Une couleur ne doit
jamais être appliquée aveuglément à toute la texture : seuls les canaux et masques
exportés ou créés par l'auteur sont modifiables.

## Caméras normalisées et contrôlables

La caméra du thème appartient à notre composition, pas au moteur original. Un
adaptateur peut extraire des caméras, splines, limites ou plans de cadrage du jeu et
les proposer comme presets ; le compilateur les convertit ensuite vers des
`camera_rig` indépendants de la source :

| Rig | Usage | Paramètres personnalisables typiques |
| --- | --- | --- |
| `fixed` | tableau ou cadrage verrouillé | preset, champ de vision, cible |
| `orbit` | inspection libre bornée | cible, lacet, tangage, distance, inertie |
| `follow` | suivi d'une instance stable | cible, offset, anticipation, lissage |
| `rail` | course ou visite guidée | spline, progression, regard, bouclage |
| `cinematic` | transition ou séquence | clip, marqueurs, interruption, retour |
| `parallax_2d` | scène plane ou multi-calques | amplitude, profondeur, lissage |

Chaque rig déclare ses bornes, sa safe area, son comportement en mouvements réduits,
son fallback et les capacités optionnelles de collision caméra. La modale permet de
choisir un rig/preset autorisé, d'ajuster ses paramètres bornés et de restaurer les
valeurs du thème. « Jouer avec la caméra » active un mode d'interaction explicite sur
la surface qualifiée ; il ne capture jamais le clavier ou la souris utilisés par une
autre application.

La caméra n'impose aucune boucle permanente. Un geste invalide le rendu seulement
pendant le déplacement et son inertie bornée. Une caméra fixe revient à zéro frame
au repos ; une caméra de rail ne reste active que si la recette demande réellement
une animation continue. Occlusion, pause du mouvement et préférence de mouvements
réduits arrêtent proprement sa progression selon la politique du thème.

## Frontière commune des convertisseurs

### Recherche et concept obligatoires avant conversion

La création d'un thème commence en lecture seule. Le préparateur identifie l'entrée
locale, étudie le moteur et couvre archives, graphe de scène, géométrie, matériaux,
textures, animations, collisions, placements, effets, audio, UI et comportements.
Chaque conclusion distingue documentation officielle, implémentation publique,
observation locale et hypothèse. Un viewer public peut documenter un lecteur ou servir
d'oracle ; il ne fournit ni assets, ni runtime de substitution.

Avant de produire le premier dérivé, le préparateur remet un
`orbite.wallpaper-concept/1`. Il propose la scène, son mouvement ambiant, les objets
réellement inventoriés, les rôles de sessions, les intentions `focus/open`, les cibles
pinnables, les menus automatiques, les contrôles système et le comportement énergétique.
La proposition explique pourquoi chaque objet convient au rôle. Une silhouette,
créature, embarcation ou interface n'est jamais sélectionnée à partir du seul nom du
jeu.

La génération reste fermée jusqu'à l'acceptation explicite d'une proposition par
l'utilisateur et jusqu'à ce que tous les sous-systèmes soient `studied` ou
`not_applicable`. `missing` et `unsupported` peuvent apparaître dans le plan, mais
maintiennent `generation_allowed: false`. Ce gate empêche une première map longuement
ajustée à la main de masquer l'absence d'un convertisseur réutilisable.

### Ledger exécutable du premier rendu

Après acceptation du concept, chaque adaptation conserve un
`orbite.game-theme-authoring-run/1`. Ce ledger sépare le candidat privé de
l'installation active et impose dix-sept gates ordonnés : intégrité de l'entrée,
recherche moteur, fermeture de l'inventaire, repères, dépendances, relations source,
déterminisme, seconde scène témoin, animations, effets, UI, sessions, runtime isolé,
matrices visuelle et interactive, pause/occlusion, puis seulement activation native.

Le profil moteur enregistre explicitement latéralité, axes haut/avant, unité,
conversion métrique, ordre des transformations et convention matricielle. Il nomme
aussi la provenance de la durée d'animation, du bouclage, du root motion, des points
d'attache, des émetteurs, des matériaux et des dépendances. Une sonde asymétrique
valide ces conventions avant le premier export visible.

Les relations minimales `placement`, `attachment`, `effect_origin` et
`interactive_hit_region` sont planifiées comme matrices ouvertes. Une relation peut
être prouvée `not_applicable`, mais jamais remplacée par une constante de secours.
Le graphe de dépendances est fermé lorsque `resolved == discovered` et
`unresolved == 0`; les cycles sont comptés sans duplication.

La scène témoin diffère de la scène principale et passe par le même adaptateur sans
modification du runtime. Le candidat est ensuite exécuté dans un viewer isolé. Le
wallpaper installé, son processus et ses permissions restent intacts tant que les
seize premiers gates n'ont pas tous une preuve `pass`. La commande suivante calcule
séparément les droits de génération et d'activation :

```bash
node scripts/verify-game-theme-authoring-run.mjs private/candidate/run.json
```

Le playbook complet destiné aux agents est fourni par
`.agents/skills/game-theme-author/references/first-pass-playbook.md`. Il décrit les
livrables attendus, la recherche du moteur, les animations sans téléportation de
boucle, la cardinalité des émetteurs, les menus automatiques et le test universel à
deux scènes.

« Tous les émulateurs » désigne ici toutes les sources pour lesquelles un adaptateur
peut produire le contrat canonique, et non l'embarquement d'un émulateur dans le
runtime. Décompilations, parseurs statiques, outils communautaires et émulateurs
instrumentés peuvent servir hors ligne de lecteurs ou d'oracles. Leur sortie passe
par la même frontière : ressources, profils de rendu, clips, apparences, caméras,
collisions, chemins, provenance et capacités qualifiées.

Le cœur ne reçoit aucun pointeur mémoire, opcode, type de console ou identifiant de
moteur source. Il reçoit des identifiants stables et une couverture explicite. Une
absence produit `missing` ou `unsupported`; elle n'est ni simulée silencieusement ni
compensée par l'exécution du jeu. Notre graphe d'actions, nos trajectoires d'ambiance,
nos liens de sessions et notre politique énergétique prennent alors le relais.

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

Sur le PoC macOS qualifié, l'essai réel a invalidé `StandardHideDesktopIcons` : la
préférence changeait et Finder se rechargeait, mais les éléments restaient affichés.
Le connecteur utilise donc `com.apple.finder/CreateDesktop`, confirme l'écriture,
rafraîchit Finder et restaure la valeur précédente si ce rafraîchissement échoue.
Il évite tout redémarrage lorsque l'état demandé est déjà présent. Quand le bureau
Finder est visible, son arbre AX protège icônes et contrôles natifs. Quand il est
masqué, le tap global reste passif : de petites fenêtres transparentes, sans pixels
et limitées aux contrôles/objets, sont placées derrière les applications ordinaires.
Elles suivent la même horloge `ThemeLayout` que le rendu et disparaissent avec cet
état. Il n'existe aucune fenêtre d'entrée plein écran en mode masqué.

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

Toute correction du contrat, d'un adaptateur ou du rendu suit désormais le
[protocole méthodique](../methodical-correction.md). La qualification lie les hashes
du package et du processus actif à une matrice visuelle ; compilation et capture
isolée ne suffisent plus.

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
| `appearance_sets` | variantes de ressource, matériaux, canaux de couleur et signatures de compatibilité |
| `scene` | instances, hiérarchie, caméra, éclairage et couches |
| `camera_rigs` | rigs normalisés, presets, bornes, fallbacks et préférences de mouvement |
| `ui` | tokens, composants, panneaux, navigation et accessibilité |
| `bindings` | événements, conditions, actions, cibles et résultats |
| `system_controls` | placement, style, ordre et présentation des capacités standard |
| `pinning` | cibles, visibilité inter-fenêtres, cadre d'édition, bornes et persistance |
| `capabilities` | fonctions requises, optionnelles et fallbacks |
| `profiles` | budgets de rendu, animation, audio et qualité |
| `provenance` | auteur, licences, versions, outils et contenu exportable |

Les placements variant avec plusieurs choix utilisent uniquement une table générique
`selections → part → transform`. Les clés de `selections` sont les catégories ouvertes
déclarées par les étapes du menu. Le runtime vérifie chaque référence, refuse les
cellules dupliquées et applique la relation sans connaître le nom ni le métier des axes.

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
ni avertissement après l'ajout du flux de modèles digestés et de restauration.
Le modèle de gestes réside dans la composition du thème ; ce repère de responsabilité
ne signifie pas que le raccord natif ou le courtier d'actions est livré.
Les libellés sont en français ; l'interface fixe du viewer reste en anglais.
