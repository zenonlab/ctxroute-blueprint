# Transformation du jeu et exécution sélective

État : bibliothèque canonique et diorama ambiant confirmés le 7 septembre 2026 ;
technologies et formats encore ouverts. Aucun extracteur n'est implémenté.
Voir le [schéma conceptuel](src/game-transformation.architecture.json).

## Intention confirmée

L'infrastructure doit permettre de programmer des expériences à partir de jeux
différents. Mario Kart, ses portraits et sa minimap sont des exemples, pas des
cas particuliers à inscrire dans le cœur du produit. La composition par code
est prioritaire ; un éditeur grand public n'est pas une exigence actuelle.

Le produit cible est le thème wallpaper/terminal. La bibliothèque peut s'étendre
au jeu entier, mais sa conversion complète n'est pas requise avant de composer.
Préparer à la demande puis charger seulement les dépendances nécessaires.
La portée de l'analyse hors ligne et celle de l'exécution sont distinctes.
La couverture complète de tout jeu reste un objectif, pas une capacité démontrée.

Le mode d'exécution principal est un diorama ambiant : animations autonomes,
réactivité aux événements système utiles et clics diégétiques. Les comportements
de gameplay peuvent être adaptés dans la composition. Le contrôle direct reste
une extension optionnelle à activation explicite ; il ne capte pas le clavier
du bureau en mode nominal. La fidélité sensorielle est un objectif à vérifier,
et non une propriété garantie par le format ou par l'extracteur.

## Frontières de l'infrastructure

| Étape | Responsabilité | Résultat attendu |
| --- | --- | --- |
| Lecture et analyse hors ligne | Réutiliser lecteurs, extracteurs et travaux de compréhension du jeu ; identifier données et code pertinents. | Ressources identifiées, provenance, relations et limites de couverture. |
| Bibliothèque du jeu | Conserver les ressources et les comportements compris avec leurs dépendances. | Ensemble réutilisable couvrant progressivement le jeu, indépendamment d'une composition. |
| Composition par code | Choisir scènes, entités, affichages, actions et comportements ; résoudre les dépendances utiles. | Sélection préparée pour l'expérience terminal, desktop ou intégrée. |
| Exécution sélective | Charger et activer cette sélection, piloter affichage et comportements nécessaires. | Expérience autonome sans faire fonctionner le jeu complet en arrière-plan. |

Ces étapes sont des responsabilités, pas une décision sur les processus,
bibliothèques, formats, bases de données ou langages à utiliser.
Un adaptateur spécifique au jeu ou à son moteur peut contenir des connaissances
particulières. Le cœur commun ne doit pas dépendre des identifiants Mario Kart.
On privilégie des adaptateurs existants ; l'objectif n'est pas de créer un
nouveau lecteur universel de toutes les consoles.

## Découverte assistée par IA à la demande

L'utilisateur peut demander une préparation pour un jeu non encore pris en
charge. Il n'est pas nécessaire de l'avoir inscrit dans un catalogue fermé.
L'IA de préparation est distincte des agents de travail du terminal et du
runtime des thèmes. Son fournisseur, son lieu d'exécution et son langage ne
sont pas décidés ; le contrat de confidentialité s'applique dans tous les cas.

1. Décrire le thème souhaité et les dépendances manquantes ; réutiliser d'abord
   un adaptateur validé et une bibliothèque locale existants lorsqu'ils suffisent.
2. À la demande, rechercher sur Internet à partir du nom/version publics du jeu
   les dépôts et documents pertinents, sans transmettre la ROM ou ses extraits.
3. Examiner rôle réel, provenance, licence, version prise en charge et dépendances
   de chaque outil ; distinguer lecteur, décompilation, mod et émulateur.
4. Préparer une chaîne minimale et un adaptateur si nécessaire. Inspecter le code
   avant exécution ; un README est une donnée non fiable, pas une instruction
   autorisant l'accès aux secrets, au réseau ou au système de l'utilisateur.
5. Sous les permissions accordées, exécuter les outils dans un environnement
   local isolé : entrée en lecture seule, sortie dédiée, limites de temps/mémoire,
   accès réseau désactivé pendant le traitement privé. L'installation des outils
   est une phase distincte. L'isolation effective devra être testée par OS.
6. Valider structure, références et capacités puis comparer les résultats.
   Corriger dans un budget borné d'essais ; en cas de manque, signaler exactement
   la capacité absente au lieu de prétendre à une conversion complète.
7. Conserver révisions, configuration, commandes, dépendances et reçus locaux
   pour réutiliser la chaîne sans nouvelle recherche IA. Invalider sa certification
   si la version d'entrée, les outils ou le contrat changent.

Une IA distante peut analyser le code public des outils ; elle ne reçoit pas
de code décompilé de la ROM utilisateur, dump, capture ou trace contenant ses
données. Le diagnostic privé reste local ; la stratégie d'assistance locale ou
de messages assainis sans contenu du jeu est à choisir. La recherche publique
ne constitue donc pas une autorisation d'envoyer toute trace au modèle.

L'absence de dépôt utilisable est un résultat légitime : proposer une capacité
réduite explicitement acceptée ou un travail d'adaptation distinct. Une extension
libre du système n'est pas une promesse de décompilation automatique de tout jeu.
Les adaptateurs réutilisables ne contiennent pas les données privées ; leur
partage éventuel nécessite vérification du contenu et des licences.

## Package de thème et dépendances séparées

Le livrable créatif est un package de thème installable : notre logique de
wallpaper/terminal, dispositions, paramètres, interactions et créations, avec
un manifeste des références externes et capacités requises. Le format exact
et les droits d'exécution des scripts restent à spécifier. Une recette est la
description de composition du package, pas une copie de la bibliothèque du jeu.

| Ensemble | Contenu | Règle |
| --- | --- | --- |
| Package de thème | Nos règles, créations, configuration et références | Partageable sans incorporer les ressources ou la logique extraites du jeu. |
| Bibliothèque locale du jeu | Ressources, relations et logique originale effectivement récupérées | Dépendance privée séparée ; non réécrite par le thème. |
| Résolution et cache locaux | Sélection et dérivés nécessaires à l'affichage | Reconstruisibles, non inclus automatiquement dans le package partageable. |

« Toute la logique du thème » ne signifie pas tout le code du jeu : la logique
originale récupérée reste dans les dépendances du jeu. Une modification créée
par nous appartient à la composition ; les sources ne sont pas fusionnées.
La résolution des dépendances au chargement n'exige pas une archive monolithique.
Un thème purement original saute entièrement la branche ROM/IA/conversion.
Le schéma regroupe recherche et outils dans la préparation hors runtime ; il
n'autorise aucun flux de ROM vers une IA distante. « Sans IA requise » concerne
le thème, pas les agents que l'utilisateur lance volontairement dans ses shells.

## Bibliothèque canonique et conversion par scène

La bibliothèque décrite ici est locale à la machine utilisateur. Voir aussi
[ADR-0032](../decisions/ADR-0032-local-conversion-and-theme-distribution.md).

La bibliothèque est le référentiel persistant du jeu : index des scènes
identifiées, ressources partagées, textures, animations, audio, collisions,
paramètres et relations. Dédupliquer les contenus identiques sans fusionner
leurs identités logiques ni perdre les références et provenances d'origine.

Le pipeline vise l'indexation globale du support et de ses ressources communes,
puis la matérialisation progressive par scène. Une scène n'est pas présumée
autonome : son export résout les ressources partagées et dépendances nécessaires.
Les portions encore inconnues de l'index sont signalées, pas déclarées couvertes.
La sélection `export --scene <id>` exprime la capacité souhaitée ; cette notation
ne fige pas encore un exécutable, une CLI publique ou un format de bundle.

La couverture doit distinguer scènes identifiées, scènes matérialisées,
catégories récupérées et catégories inconnues/non supportées. Elle ne se réduit
pas à un pourcentage global qui masquerait l'absence de collisions ou d'audio.

## Distribution et conversion locale séparée

Trois livrables sont distincts : application terminal/wallpaper, recettes de
thèmes, convertisseur hors ligne avec ses adaptateurs. Le convertisseur est
installable et exécutable séparément ; il n'est pas nécessaire à l'affichage
d'une composition déjà préparée. Le packaging exact reste à choisir.

Nous distribuons les outils et recettes, pas les ROM ni les bibliothèques ou
bundles contenant des assets extraits des jeux. Les recettes décrivent des
références, dispositions, comportements et paramètres, sans incorporer textures,
portraits PNG, modèles, musiques ou code récupérés du jeu. Aperçus de catalogue
et fixtures suivent la même séparation : utiliser des ressources originales ou
explicitement autorisées. Les licences des outils et contenus distribués restent
à examiner avant publication ; cette frontière n'est pas une conclusion juridique.

L'utilisateur fournit son entrée et lance le convertisseur sur sa machine.
Le parcours ne transmet ni ROM, ni assets, ni dumps ou captures à nos services
ou à une IA distante. Télécharger des outils/recettes est distinct du traitement
local des données ; aucun catalogue ou service réseau n'est encore choisi.

Interprétation de travail de « on n'enregistre rien » : aucune collecte ou
conservation de données de jeu côté fournisseur. Une bibliothèque persistante
sur le disque utilisateur reste l'hypothèse cohérente avec ADR-0031, à confirmer
pour son emplacement, sa durée de conservation, sa purge et un éventuel mode
éphémère. Ne pas annoncer une absence de stockage local. Aucune suppression
automatique de la ROM ou de la bibliothèque n'est autorisée par cette décision.

### Activation d'un thème

1. Installer l'application et une recette sans assets extraits.
2. Vérifier localement les ressources et capacités requises par cette recette.
3. Si elles manquent, indiquer jeu/version et dépendances attendues, sans
   télécharger le jeu ; l'utilisateur lance le convertisseur séparé sur sa ROM.
4. Indexer, extraire progressivement et valider provenance, relations et capacités.
   Une version inconnue n'est pas considérée comme compatible par défaut.
5. Résoudre les références locales et préparer les dérivés nécessaires.
6. Afficher la composition sans ROM ouverte, convertisseur ni émulateur actif.

Un thème de jeu sans bibliothèque compatible reste indisponible avec explication.
Le terminal et les thèmes sans dépendance ROM doivent rester utilisables.
Changer de thème conserve les sessions, leurs identités et le travail en cours.

### Contrats à préciser avant implémentation

- Identités/versionnement de jeu, adaptateur, ressource et recette ; références
  stables entre scène, minimap, portraits et animations.
- Résolution des dépendances partagées, validation des capacités, cache et
  invalidation des dérivés lorsque leurs entrées changent.
- Export partageable distinct des résultats privés ; aucune bibliothèque locale
  incluse automatiquement dans une recette publiée.
- Adaptateurs et scripts importés non fiables : limites de ressources et accès
  fichiers, isolation et permissions explicites à définir.
- Actions système autorisées par l'utilisateur ; un thème importé ne dispose
  pas implicitement d'un accès arbitraire au shell.
- Diagnostics locaux sans contenu du terminal ou octets du jeu par défaut ;
  assainissement d'un éventuel rapport volontaire à spécifier.

La génération d'adaptateurs par IA distante n'est pas un prérequis et ne peut
contourner cette frontière de confidentialité. Aucun protocole, format ou
sandbox n'est adopté par cette description.

## Préservation sans suppression volontaire à l'ingestion

Conserver toutes les informations effectivement récupérées : géométrie,
topologie, drapeaux de surface, paramètres, tables, animations, audio, code ou
scripts compris et leurs relations. Conserver leur provenance et leur version ;
les représentations normalisées ne doivent pas effacer leurs sources ou les
propriétés que le diorama n'utilise pas encore. Les blocs identifiés mais non
interprétés doivent rester traçables et distingués des données comprises.

Les simplifications appartiennent aux dérivés de composition, jamais à une
réécriture destructive de la bibliothèque. Elles peuvent être préparées hors
ligne pour économiser le runtime : maillage de picking simplifié, matériau
de repli, rendu audio ou sélection d'animations. Le choix est celui de la
composition ; il n'est pas nécessaire de recalculer ces dérivés à chaque
instanciation. Retrouver une propriété déjà conservée ne nécessite pas une
nouvelle extraction ; comprendre une propriété jusque-là inconnue peut en
revanche nécessiter un nouveau passage du lecteur.

## Ce que signifie récupérer une mécanique

| Catégorie | Contenu | Limite à préserver |
| --- | --- | --- |
| Ressource visuelle | Maillage, texture, squelette, poses, animation | Une animation de saut ne produit pas à elle seule un déplacement physique. |
| Donnée physique | Surfaces, volumes, propriétés, paramètres | La géométrie ne définit pas à elle seule les réponses aux collisions. |
| Règle de comportement | Marche, gravité, impulsion, états, réaction au contact | Peut résider dans des scripts ou du code machine, et dépendre d'autres systèmes. |
| Relation | Entité vers modèle, portrait, icône, état ou transformation | Doit survivre à l'export des fichiers pour permettre l'automatisation. |

Déchiffrement éventuel, décompression, parsing de formats, décompilation et
recompilation sont des opérations différentes. Ouvrir une ROM ne transforme
pas automatiquement ses règles en composants indépendants.

Pour chaque comportement, distinguer : original récupéré, original adapté,
équivalent réimplémenté, animation précalculée, ou non supporté. Cette distinction
évite de présenter une imitation visuelle comme une mécanique originale.
Le diorama autorise les comportements adaptés et simplifiés, en conservant la
distinction et la source originale disponible. La bibliothèque peut accueillir
des mécaniques plus fidèles ultérieurement sans les activer dans chaque composition.

## Relations communes entre représentations

Une même entité peut posséder une représentation dans la scène, sur une minimap
et dans un portrait. Conserver les identifiants, références, repères et
transformations permet de synchroniser ces vues. Les sessions de terminal sont
associées à ces entités par la composition, sans confondre session et apparence.

Les PNG sont des ressources ; leurs liens sémantiques doivent être conservés
séparément. Les captures d'écran peuvent aider à comprendre une disposition ou
à vérifier un résultat. Une capture seule ne démontre ni un identifiant, ni une
collision, ni la logique interne du jeu ; une association inférée doit être
distinguée d'une association retrouvée dans les données ou le code.

L'automatisation doit s'appuyer sur les relations disponibles dans les lecteurs.
Les relations manquantes demandent un travail d'adaptation explicite ; aucun
étiquetage IA ou recalage d'image n'est imposé comme solution universelle.

## Réduction du coût d'exécution

- Préparer hors ligne les conversions et calculs indépendants de l'interaction.
- Sélectionner les ressources et comportements avec leurs dépendances transitives,
  sans charger le reste du jeu pour chaque composition.
- Activer uniquement les entités et systèmes nécessaires ; suspendre le travail
  inutile lorsque l'expérience est inactive ou invisible, selon une politique à définir.
- Séparer affichage, animation et simulation. Réduire la fréquence d'affichage
  ne doit pas modifier arbitrairement la physique conservée.
- Précalculer les séquences déterministes lorsque cela convient ; les interactions
  imprévisibles exigent toujours des calculs au runtime.
- Mesurer le coût de la composition séparément de celui des commandes et agents.

Le saut peut dépendre du sol, des murs, des pentes, des plateformes mobiles,
de l'état du personnage et du pas de simulation. Supprimer une dépendance ne
constitue une optimisation valide que si le comportement attendu est conservé
ou si la simplification est explicitement acceptée.
Une recompilation native ne garantit pas à elle seule une faible consommation.

## Capacités explicites et dégradations qualifiées

Chaque export doit indiquer les capacités réellement disponibles, leur périmètre
(scène ou ressource), la provenance, les approximations et les raisons des
désactivations. Le runtime vérifie les capacités requises avant d'activer un
système. Une capacité inconnue ne vaut pas une capacité disponible.

| Usage | Condition d'activation | Repli et conséquence |
| --- | --- | --- |
| Sol et navigation | Collision séparée validée et données nécessaires au comportement de déplacement | Aucune AABB générique ne remplace un sol. Si insuffisant : entités statiques, animations sur place possibles, patrouille dynamique désactivée. |
| Clic sur un objet | Volume de picking identifié | AABB possible à partir de la géométrie, avec précision annoncée comme approximative ; ne confère aucune capacité de navigation. |
| Matériaux | Effets et propriétés nécessaires effectivement restitués | Unlit/Lambert possible si la composition l'accepte ; fidélité visuelle signalée comme approximative. |
| Audio en boucle | Points, unité temporelle, séquence/décodage et continuité validés | Lecture unique ou crossfade explicitement choisi et signalé ; ne pas annoncer une boucle exacte. |

Un TriMesh avec normales valides ne prouve pas à lui seul qu'un personnage sait
naviguer : les surfaces pertinentes, obstacles, chemins et règles nécessaires
au déplacement retenu doivent aussi être validés.

Un manifeste typé de capacités est requis conceptuellement. L'exemple utilisateur
`navigation: false, visual_fidelity: fallback_unlit, audio_loop: exact` illustre
ces informations, mais le schéma et les valeurs définitives restent à concevoir.
Un journal structuré devra relier chaque omission ou approximation à sa source.
Un export partiel peut réussir avec restrictions ; une corruption empêchant de
garantir sa structure ou une dépendance obligatoire non résolue ne doit pas être
masquée par un fallback silencieux.

## Profils énergétiques à mesurer

| Profil | Politique cible | Conditions |
| --- | --- | --- |
| Économie | Cadence d'origine lorsqu'elle est connue, généralement 20–30 FPS pour les exemples visés ; pas d'interpolation visuelle supplémentaire | Défaut sur batterie. Suspension du rendu de la surface entièrement masquée. |
| Bureau fluide | Cible 60 FPS avec interpolation adaptée aux transformations | Sur secteur et bureau actif. Réduction ou suspension lorsque les animations et événements utiles le permettent. |
| Haute fréquence | Cadence de l'écran, notamment 120+ Hz | Option expérimentale explicite ; mesures et limites thermiques à définir avant activation. |

La cadence d'origine vient du jeu/de la séquence identifiée, pas d'une constante
universelle par console. Les interpolations de rotation doivent respecter leur
représentation ; les paramètres du solveur physique ne suivent pas arbitrairement
la cadence d'affichage. Sans input, une animation autonome peut encore justifier
un rendu : la politique doit choisir explicitement de la poursuivre, la ralentir
ou la mettre en pause. Ne pas promettre simultanément 1 FPS et animation fluide.

La suspension concerne les surfaces entièrement masquées, selon les capacités
réelles de l'OS et la configuration multi-écrans. Elle ne suspend ni les shells
ni les agents de travail. Le comportement audio en arrière-plan reste à choisir.
Zéro frame soumise n'est pas une garantie de consommation nulle du système.

Les cibles inférieures à 1–2 % CPU/GPU sont des budgets exploratoires soumis
à mesure. Définir matériel, résolution, nombre d'écrans, scène, nombre d'entités,
alimentation, durée et méthode de calcul avant d'en faire un critère bloquant.
Comparer aussi mémoire, énergie et réactivité. Les iGPU et Apple Silicon sont
prioritaires ; les références matérielles précises restent à sélectionner.

## PoC préalable à la sélection définitive du jeu pilote

Ocarina of Time est le candidat prioritaire. Tester une scène unique, Temple du
Temps ou Maison de Link, après identification d'une version exacte du jeu et
de ce que les outils savent réellement extraire. SM64 et Sunshine sont des
alternatives à évaluer si des relations critiques manquent ou si l'intégration
spécifique devient excessive ; aucune bascule automatique n'est définie.

| Preuve | Critère de réussite |
| --- | --- |
| Pièce et matériaux | Géométrie complète de la pièce, textures et couleurs de sommets conservées, orientation et UV vérifiées dans un visualiseur ; approximations recensées. |
| Acteur animé | Squelette et au moins une animation cyclique rejouable ; provenance et éventuelle boucle artificielle distinguées de l'animation originale. |
| Collision | Données séparées du maillage visible, avec surfaces et propriétés identifiées ; pas de substitution silencieuse par la géométrie de rendu. |
| Audio | Relation scène → musique prouvée ; flux ou séquence avec ses dépendances et repères, puis lecture en boucle réellement testée. Des tags seuls ne suffisent pas. |
| Placements | Positions et repères rattachés aux données de scène, de salle ou de spawn ; transformations documentées, sans repositionnement manuel présenté comme original. |
| Sélection et conservation | Export de la scène avec ses dépendances ; données originales récupérées toujours disponibles, systèmes non nécessaires absents de l'exécution. |

Si le personnage démontré n'est pas un acteur placé dans la salle, documenter
séparément l'origine de son modèle/animation et celle de son point d'entrée.
Une insertion décidée par la composition reste autorisée comme démonstration,
mais ne satisfait pas la preuve d'un placement extrait.
De même, une musique séquencée peut demander banques d'instruments et rendu
hors ligne ; elle ne doit pas être traitée comme un fichier Ogg déjà présent.

Le rapport du PoC doit fixer les révisions des outils, l'identité de l'entrée,
les commandes exécutées, les ressources obtenues, les références manquantes,
les capacités et les preuves visuelles/audio. Évaluer le code de liaison requis
avant de fixer formats et stack. Aucun outil n'est adopté sur sa réputation seule.

## Éléments vérifiés dans les projets existants

Sources consultées le 7 septembre 2026. Il s'agit d'une lecture documentaire et
de code public, sans exécution d'une ROM ni validation d'un port dans ce dépôt.

- Super Mario 64 sépare le chargement de surfaces et les actions aériennes :
  exemples concrets de données de collision et de code de comportement distincts.
  [Surfaces](https://github.com/n64decomp/sm64/blob/master/src/engine/surface_load.c),
  [actions aériennes](https://github.com/n64decomp/sm64/blob/master/src/game/mario_actions_airborne.c).
- N64Recomp traduit des binaires N64 en C à partir de symboles et métadonnées ;
  son usage prévoit un runtime et peut viser une portion d'un binaire.
  Cela ouvre une piste de réutilisation sans fournir une séparation automatique
  de chaque mécanique. [Documentation du projet](https://github.com/N64Recomp/N64Recomp).
- Dans Mario Kart 64, le rendu de minimap utilise la position X/Z du joueur,
  une échelle et des offsets ; l'icône et les portraits dépendent d'identifiants
  de personnages. L'extraction des icônes PNG est décrite séparément.
  [Rendu](https://github.com/n64decomp/mk64/blob/master/src/render_objects.c),
  [extraction](https://github.com/n64decomp/mk64/blob/master/assets/include/minimap_icons.mk).
- Le lecteur Mario Kart Wii de noclip exploite notamment les placements KMP et
  les associations ObjFlow ; il comporte aussi des traitements particuliers et
  des objets non implémentés. Un lecteur visuel n'est pas une restitution complète
  du gameplay. [Lecteur](https://github.com/magcius/noclip.website/blob/main/src/MarioKartWii/Scenes_MarioKartWii.ts).
- RiiStudio documente des outils de lecture de modèles, extraction SZS et
  conversion KMP vers JSON. Ce sont des briques candidates, pas une stack
  approuvée. [RiiStudio](https://github.com/riidefi/RiiStudio).

Ces références démontrent des possibilités par jeu ou format. Elles ne prouvent
pas un pipeline général capable de convertir toutes les mécaniques de tout jeu.
Avant adoption, figer les versions étudiées et examiner couverture, dépendances,
licences et compatibilité des outils avec le projet.

## Questions pour la suite

Le mode ambiant, la conservation des données et la conversion progressive sont
désormais tranchés. Restent à préciser : la ROM/version disponible, la scène
exacte du PoC, les machines de mesure, les seuils thermiques et la politique
audio au repos. La stack, les interfaces et formats seront décidés après les
preuves. Cette étape documentaire n'a pas exécuté le PoC ni extrait de ROM.

## Schéma et preuves documentaires

Le schéma Archify a passé les neuf contrôles showcase sans erreur ni
avertissement et a été livré dans
`dist/architecture/game-transformation.architecture.html`.
Le contrôle automatique aux quatre résolutions de bureau a réussi ; la capture
sombre à 2048×1320 a été inspectée par l'agent. Le reçu conserve la revue humaine
en attente. Le contenu est en français, les commandes du visualiseur en anglais.

Les empreintes de la livraison courante sont fournies par `npm run build:docs`
et le reçu `dist/architecture/game-transformation.architecture.visual-check.json`.
