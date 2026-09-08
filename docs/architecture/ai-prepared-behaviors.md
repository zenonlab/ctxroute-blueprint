# Préparation IA et comportements portables

Décision d'architecture du 7 septembre 2026, pas une fonction implémentée.
Voir [ADR-0041](../decisions/ADR-0041-ai-prepared-selective-behaviors.md),
[C0–C6](module-contracts.md), [interactions UI](theme-interactions.md) et
[schéma de préparation](src/game-transformation.architecture.json).

## Solution retenue

Direction retenue pour expérimentation, non solution optimale démontrée.
Le [plan L1–L3](../05-poc-start-plan.md) borne les premières implémentations :
contrôleurs compilés relus, données originales, événements simulés ; pas de code
généré exécuté ni de parseur universel. A01–A08 restent des tests à réaliser.

**L'IA prépare une composition vérifiée ; un runtime déterministe l'exécute.**
L'utilisateur décrit le résultat voulu, pas une liste de parseurs à assembler.
La préparation recherche les outils, résout les relations et propose ou génère
les adaptations nécessaires. La difficulté propre au jeu reste dans l'adaptateur
et sa préparation ; elle ne devient pas une exception dans le cœur du wallpaper.

Prendre en charge des entrées 2D, 3D, hybrides ou à moteur custom : ROM, fichiers
de jeu ou projet disponible. Ne pas demander à tout convertir en glTF ni en 3D.
Un système ouvert accepte la demande pour un jeu inconnu ; il ne garantit pas
qu'une IA saura automatiquement en comprendre tout le code ou récupérer ses clés.
Une couverture partielle doit identifier les capacités manquantes.

Le choix par défaut est **données originales utiles + contrôleurs de thème
adaptés**, avec portage de logique originale seulement lorsqu'il est pertinent
et isolable. Le rendu, le mouvement réel, les effets et les panneaux restent
programmables. Ce choix ne remplace pas une course demandée par des icônes fixes.

## Arbitrage des approches

| Approche | Quand l'utiliser | Pourquoi ne pas la généraliser |
| --- | --- | --- |
| Reprendre le jeu/moteur complet | Référence d'analyse hors runtime, si autorisée | Conserve des systèmes inutiles ; incompatible avec l'objectif d'exécution sélective |
| Porter une fonction originale et ses dépendances | Comportement indispensable, compris, borné, testable et suffisamment économe | Une fonction peut dépendre de mémoire globale, physique, objets ou timing du jeu |
| Données originales + contrôleur adapté | Choix prioritaire pour trajectoires, formations, ambiance et liens de sessions | Fidélité comportementale adaptée, à annoncer ; ne pas prétendre copier les bots à l'identique |
| Animation ou trajectoire précalculée | Mouvement suffisamment fixe avec branches/paramètres couvrant le besoin | Ne répond pas seule aux interactions géométriques arbitraires |
| Logique reconstruite sans donnée source suffisante | Proposition explicite après recherche infructueuse | Approximation, jamais présentée comme extraite ; changement fonctionnel soumis à validation |

La recompilation statique n'est pas exclue par principe : N64Recomp décrit la
traduction en C et l'exécution de parties de binaire, mais exige métadonnées et
runtime adapté. Elle n'effectue pas automatiquement l'isolation sémantique d'un
contrôleur. [N64Recomp, README à révision fixe][recomp].
Choisir sur le périmètre fonctionnel, le coût énergétique mesuré, la maintenance
et les droits de réutilisation ; aucune méthode n'est intrinsèquement gagnante
pour tous les jeux.

## Ce que l'IA produit et ce que le runtime reçoit

Une même préparation remplit les responsabilités existantes, sans ajouter un
service permanent, un démon par moteur ou un grand DSL de gameplay universel.

1. **Demande fonctionnelle** : résultats observables, capacités indispensables,
   substitutions permises, paramètres de personnalisation et budget d'exécution.
2. **Plan sourcé** : moteur/format/version probables, dépôts et licences inspectés,
   révisions figées, preuves disponibles et hypothèses encore ouvertes.
3. **Adaptateur local** : réutilisation ou code de liaison borné pour lire les
   données et retrouver les relations. Priorité aux adaptateurs déjà validés.
4. **Composition** : références stables, paramètres, contrôleurs, liaisons avec UI
   et états de sessions. Les algorithmes génériques sont réutilisés ; l'IA produit
   surtout leur configuration et la colle manquante.
5. **Validation** : références, types, repères, permissions, limites, comportement
   sur fixtures et coût sur machine cible. Une capture convaincante n'est pas
   une preuve de collision, de trajectoire sûre ou de fidélité comportementale.
6. **Résultat réutilisable** : recette, dépendances privées et cache distincts,
   reçus et diagnostics. L'activation ultérieure n'appelle pas le LLM et ne
   réanalyse pas le jeu. Revalidation si entrées/outils/contrats changent.

C0 porte la recette et ses capacités ; C6 conserve les résultats compris ; C1
résout les dépendances ; C2 active les contrôleurs et échange leurs événements
sémantiques. Le calcul par frame reste local à l'hôte. C3 publie les états de
session autorisés ; C4 demeure le flux terminal privé ; C5 qualifie les surfaces.
Un graphe de dépendances de préparation n'est pas un bus de messages permanent.

Chaque capacité indique sa provenance et son état : récupérée, traduite,
adaptée, estimée ou indisponible, avec distinction entre preuve documentaire et
preuve exécutée. Ces mots expriment la sémantique ; le schéma exécutable reste E3.
Les sorties de l'IA sont non fiables tant qu'elles ne sont pas validées.

### Contexte obligatoire avant génération d'un thème

Le générateur reçoit avant toute écriture le starter canonique, le catalogue de
capacités, les composants sémantiques, les safe areas et les politiques de repli.
Il instancie l'étagère `system_controls` dans la composition initiale : ce n'est pas
une surcouche ajoutée après que le thème a été dessiné.

Le contrôle standard couvre le mute de l'audio du thème, la pause du mouvement, le
verrouillage des interactions, le profil énergétique et l'accès aux réglages. La
visibilité des éléments du bureau est une intention conditionnelle ; l'IA ne génère
ni `defaults`, ni écriture de registre, ni commande de shell pour l'implémenter. Elle
se lie uniquement à la capacité `desktop.items.visible` et prévoit les états pending,
refusé, inconnu et non supporté.

L'IA peut proposer une autre position, transformer les boutons en objets diégétiques
ou demander leur retrait. Le validateur exige alors un chemin accessible équivalent
ou une dérogation explicite. La liberté créative ne permet pas de cacher silencieusement
la récupération, de simuler un succès ou de modifier un réglage OS au chargement.

## Petit socle extensible, représentations distinctes

Commencer par les opérations utiles aux parcours : identité/état, événement,
transform, animation, chemin, caméra, effet, panneau et action autorisée. Ce ne
sont ni des noms d'API arrêtés ni une liste limitant définitivement les thèmes.

| Représentation | Données à préserver lorsqu'elles existent | Contrôleurs possibles |
| --- | --- | --- |
| 2D | Sprites, atlas, pivots, frames, couches, tilemaps, masques et chemins | Flipbook, trajet 2D, plateforme, déclencheur de zone |
| 3D | Meshes, hiérarchie, matériaux, squelettes, collisions, chemins et repères | Clip, chemin 3D, orientation, formation, transition de caméra |
| Hybride | Sprites/billboards et géométrie, liens de profondeur et caméra | Composition de capacités 2D/3D sans conversion artificielle |
| Custom | Structures réellement comprises et leurs dépendances | Adaptateur dédié puis capacité commune ou extension explicite |

Ne pas charger navigation, physique, skinning ou VM pour un thème qui n'en a pas
besoin. Réutiliser des bibliothèques spécialisées avant de coder ces systèmes.
Si une capacité manque au runtime, l'IA ne peut pas la fabriquer en ajoutant
seulement une clé au manifeste : il faut une extension implémentée et validée.
Les extensions ne sont pas des bibliothèques natives arbitraires chargées dans
le processus ; leur contrat, isolation et quotas doivent être définis avant
exécution. Aucun choix obligatoire de Wasm ou autre langage n'est acté ici.

## Cas course : vrais virages, formation stable et sessions

Le besoin est une course dans le monde, pas des véhicules immobiles avec décor
défilant comme substitution implicite. Mario Kart 64 sert ici de **preuve publique
ciblée**, pas de jeu exigé à l'utilisateur.

Son `TrackPathPoint` contient X/Y/Z et un identifiant de section ; des tableaux
suivent parcours, points et indices par joueur. Le contrôle de vitesse CPU
consulte aussi rangs, catégorie et effets : l'IA compétitive originale n'est pas
un simple suivi de rail. Certains commentaires du header restent incertains ;
ne pas traiter les chemins gauche/droite comme des bords sûrs sans vérification.
[Header][mk-path], [contrôle de vitesse][mk-speed].

### Contrôleur de formation proposé

1. La préparation récupère ou établit une trajectoire **dans le circuit réel**,
   avec repères et branche choisie. Son origine est consignée.
2. Elle prépare distances cumulées, orientation et enveloppe de déplacement
   valide. Vérifier virages serrés, pentes, ponts, branches et raccord de boucle ;
   interpoler des points peut couper un virage ou traverser un mur.
3. Une progression commune pilote le groupe. Chaque session conserve une place
   stable, un décalage longitudinal et éventuellement latéral dans cette enveloppe.
   L'orientation suit le parcours : les véhicules tournent réellement.
4. Ajouter/retirer une session ajuste la formation sans changer les identités
   des autres. Plafond de véhicules visibles et overflow/pagination sont définis
   par le thème ; ne pas empiler un nombre illimité de modèles dans une même voie.
5. Une erreur confirmée déclenche le scénario Lakitu : véhicule pris en charge,
   puis réinséré dans sa place **mobile actuelle**, pas à une ancienne coordonnée.
   Le contrôleur suspend sa contrainte de formation pendant le transport, puis
   la reprend ; pas deux systèmes écrivant simultanément la même transformation.
6. La caméra peut suivre le groupe pour garder une lecture stable. Une formation
   stable dans le monde n'impose pas une ligne de pixels exacte dans tous les
   virages. Si l'alignement écran est indispensable, qualifier caméra et parcours
   compatibles ; ne pas sortir les karts de la route pour forcer cette contrainte.

En voie étroite, une ligne latérale fixe peut être impossible. Prévoir formation
en file, autre trajet ou réduction des éléments visibles seulement si le thème
autorise ce repli. « Facile à configurer » ne signifie pas ignorer la géométrie.
Un empilement volontaire est une disposition explicite, pas une simulation
physique émergente ni un effet attendu de la logique des bots.

L'algorithme décrit est **notre adaptation proposée**, non un comportement déjà
extrait ou mesuré. Il évite de réimplémenter compétition, objets offensifs,
classement et rubber-banding uniquement pour maintenir une formation.

### État du travail et représentation

Le thème s'abonne à des états publiés : processus présent/sorti, travail annoncé,
attente utilisateur annoncée, erreur/fin signalée, inconnu ou source déconnectée.
Ne pas déduire une panne du seul silence PTY, ni « terminé » de la présence d'un
shell. Une session peut héberger plusieurs travaux ; leur agrégation doit être
définie par la source d'événements, avec identité, fraîcheur et révision.

Lakitu est une réaction visuelle. Il ne relance pas une commande et ne transforme
pas une session toujours en erreur en session saine. Le kart peut revenir dans
la formation tout en conservant son indicateur d'erreur. La reprise réelle est
une intention séparée, explicitement autorisée et prise en charge par le terminal
ou l'agent ; aucun texte PTY n'est livré au thème ou au LLM pour cette animation.

## Sécurité, énergie et limites de l'automatisation

L'IA distante recherche et analyse les sources publiques ; ROM, fichiers privés,
captures, sorties décompilées et traces privées ne lui sont pas transmis.
Une analyse nécessitant ces données doit être locale, ou remplacée par un
diagnostic assaini selon un contrat défini. Une IA locale ajoute elle aussi des
besoins matériels hors ligne ; aucun coût nul présumé.

Pas de téléchargement/exécution aveugle du premier dépôt trouvé. Quotas de
recherche, compilation et tests ; isolation fichiers/réseau/processus ; dépendances
épinglées ; échec explicite après budget. Le générateur ne doit pas certifier son
propre résultat seulement parce que ses propres tests passent : fixtures de
référence et invariants indépendants, puis qualification OS/énergie.

L'optimisation sélectionne les dépendances du runtime ; elle n'efface pas les
sources de la bibliothèque. Une logique dérivée du jeu reste privée même si une
IA l'a réécrite. Seules les créations réellement partageables et les références
autorisées entrent dans le package ; pas de blanchiment de provenance par génération.

Préparer hors ligne les calculs fixes. En exécution, suivre événements et budget,
suspendre les surfaces masquées selon leurs capacités, annuler les contrôleurs
inactifs. La course animée exige des mises à jour tant qu'elle est visible :
pas de promesse 0 FPS avec mouvement continu ni de pourcentage CPU universel.

## Preuves ciblées et prochaine étape

OoT reste un cas d'extraction documenté, **pas le verrou de l'architecture**.
La prochaine spécification exécutable doit être guidée par trois fixtures
originales : trajet 2D, circuit 3D avec virages et branche, données custom traduites
vers le même contrat. Le cas course complète I01, il ne demande pas trois moteurs.

| Test prévu | Preuve recherchée |
| --- | --- |
| A01 — 2D/3D/custom | Même liaison session → état → contrôleur ; aucune exception de jeu dans le cœur |
| A02 — Trajet réel | Virages/pentes/raccord de boucle cohérents, sans traversée de paroi ni confusion entre étages |
| A03 — Formation | Ajout/retrait, voie étroite, nombre maximal et identité des sessions correctement gérés |
| A04 — Sauvetage | Lakitu réinsère à la place mobile ; une seule autorité de transformation ; erreur réelle conservée |
| A05 — IA absente | Thème préparé activable sans réseau ni modèle ; changement de version invalide les preuves concernées |
| A06 — État inconnu | Silence, événements périmés et déconnexion ne fabriquent ni succès ni relance |
| A07 — Sortie générée hostile | Référence, import, permission ou quota invalide refusé ; code privé non exporté |
| A08 — Sobriété | Coût des contrôleurs isolé du rendu et du terminal ; suspendre/reprendre sans saut ni rafale externe |

E1 définit les fixtures et le périmètre initial ; E2 éprouve le contrôleur minimal
avec événements synthétiques ; E3 stabilise les contrats ; E4 branche les sessions
réelles ; E5 qualifie ; E6 ajoute la préparation IA sur données de jeu. Aucun de
ces tests produit n'est exécuté par cette mise à jour documentaire.

## Sources primaires et portée de la review

Lecture publique ciblée au 7 septembre 2026, sans installer/exécuter ces projets.
Révisions relevées par API GitHub, README/code lus via raw.githubusercontent.com.
Ces exemples démontrent la diversité de l'outillage, pas une couverture universelle.

- [Mario Kart 64][mk-root], `58cfcb022e10f83bc3b889d7e97508cae6837098` :
  chemins et vitesse CPU examinés ; pas d'extraction ROM ou test de course.
- [N64Recomp][recomp], `ffb39cdad1da5de07eaaa48bd1db4a89a7986771` :
  voie possible de réutilisation partielle, runtime toujours nécessaire ; pas
  une machine de transformation sémantique de tous les moteurs.
- [UndertaleModTool][umt], `f43e12c445c37d50dc6244caa12ccab232983f3f` :
  outils GameMaker avec CLI et décompilation GML ; le README exclut YYC de
  l'édition de code GML VM. Un outil de cette famille ne certifie pas tout jeu 2D.
- [noclip.website][noclip], `6b16cfda00ef5af3ee2a66d8b928bb0bf700e5b6` :
  référence de visualisation et de travaux multi-formats ; ce viewer n'est pas
  une preuve de contrôleurs de gameplay autonomes ni un runtime desktop adopté.

[mk-root]: https://github.com/n64decomp/mk64/tree/58cfcb022e10f83bc3b889d7e97508cae6837098
[mk-path]: https://github.com/n64decomp/mk64/blob/58cfcb022e10f83bc3b889d7e97508cae6837098/include/path.h
[mk-speed]: https://github.com/n64decomp/mk64/blob/58cfcb022e10f83bc3b889d7e97508cae6837098/src/cpu_vehicles_camera_path/cpu_speed_control.inc.c
[recomp]: https://github.com/N64Recomp/N64Recomp/blob/ffb39cdad1da5de07eaaa48bd1db4a89a7986771/README.md
[umt]: https://github.com/UnderminersTeam/UndertaleModTool/blob/f43e12c445c37d50dc6244caa12ccab232983f3f/README.md
[noclip]: https://github.com/magcius/noclip.website/blob/6b16cfda00ef5af3ee2a66d8b928bb0bf700e5b6/README.md
