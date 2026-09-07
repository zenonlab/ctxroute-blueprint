# Transformation du jeu et exécution sélective

État : orientation conceptuelle confirmée le 7 septembre 2026 ; technologies,
formats et niveau de fidélité encore ouverts. Aucun extracteur n'est implémenté.
Voir le [schéma conceptuel](src/game-transformation.architecture.json).

## Intention confirmée

L'infrastructure doit permettre de programmer des expériences à partir de jeux
différents. Mario Kart, ses portraits et sa minimap sont des exemples, pas des
cas particuliers à inscrire dans le cœur du produit. La composition par code
est prioritaire ; un éditeur grand public n'est pas une exigence actuelle.

L'ambition est de transformer le jeu entier en une bibliothèque exploitable,
puis de ne charger et exécuter que les éléments nécessaires à une composition.
La portée de l'analyse hors ligne et celle de l'exécution sont distinctes.
La couverture complète de tout jeu reste un objectif, pas une capacité démontrée.

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
Le choix acceptable entre ces catégories reste à discuter.

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

1. Fidélité : faut-il conserver exactement marche/saut/collisions d'origine,
   ou peut-on remplacer certains comportements par des équivalents plus simples ?
2. Interaction : contrôle direct clavier/manette, comportements autonomes,
   réactions aux sessions, ou plusieurs de ces usages ?
3. Bibliothèque complète : une conversion progressive avec catégories non
   supportées clairement signalées convient-elle pour les premiers jeux ?
4. Validation : quel premier jeu et quelle version utiliser pour démontrer
   collisions, déplacement et composition, sans en faire une limite du cœur ?
5. Énergie : quel matériel de référence et quelle priorité entre fidélité,
   fluidité et économie lorsqu'un comportement coûteux est actif ?

Ces questions restent ouvertes ; aucune réponse n'est présumée.
La stack et les interfaces techniques seront décidées ensuite.

## Schéma et preuves documentaires

Le schéma Archify a passé les neuf contrôles showcase sans erreur ni
avertissement et a été livré dans
`dist/architecture/game-transformation.architecture.html`.
Le contrôle automatique aux quatre résolutions de bureau a réussi ; la capture
sombre à 2048×1320 a été inspectée par l'agent. Le reçu conserve la revue humaine
en attente. Le contenu est en français, les commandes du visualiseur en anglais.

SHA-256 de la source :
`7613b29b6c92d6cb42fdbcac721fbe150662a517f010c8e8ff9696711b4f7517`.
SHA-256 du HTML :
`a4d4acfeb2e644118165d5f8b6bcb67722d2d20f8723858c4d9a6329d26d8594`.
