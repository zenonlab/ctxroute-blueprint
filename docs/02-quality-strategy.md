# Stratégie qualité

Cette étape vérifie le socle et la documentation. Les scénarios produit
ci-dessous préparent la prochaine session ; ils ne sont pas encore automatisés.

## Vérification du socle

Conserver les contrôles fournis par le blueprint : installation officielle,
configuration, CTXRoute, contrats documentaires, ADR, schémas Archify, cohérence,
Sensor et tests du template. Les tests du template vérifient l'outillage,
pas un produit desktop qui n'existe pas encore.

Commandes existantes : `npm run setup`, `npm run validate`,
`npm run verify`, `npm run archify:visual-check`.
Les résultats réellement obtenus sont consignés dans la
[note de reprise](session-handoff.md).

## Scénarios d'acceptation produit

| ID | Situation | Résultat attendu |
| --- | --- | --- |
| P01 | Utiliser le terminal seul | Aucun bureau animé requis ; saisie, sélection, copier-coller, défilement et navigation clavier utilisables. |
| P02 | Utiliser le bureau seul | Décor et actions accessibles sans imposer le terminal personnalisé. |
| P03 | Ouvrir deux shells, dont un avec agent | Deux joueurs distincts ; chaque clic affiche la session correspondante. |
| P04 | Changer le personnage d'une session active | Même travail en cours ; aucune relance de processus provoquée par le changement visuel. |
| P05 | Changer le thème ou désactiver l'animation | Les sessions restent accessibles ; les associations restent cohérentes. |
| P06 | Cliquer sur une icône native ou une application | Aucune action du décor déclenchée par erreur ; focus et comportement natifs préservés. |
| P07 | Choisir un objet interactif du décor | Seule l'action configurée est demandée ; le clavier n'est capturé qu'après activation explicite du terminal. |
| P08 | Importer des assets incomplets | Couverture et dépendances annoncées ; aucune promesse de récupération totale du jeu. |
| P09 | Recomposer personnage, animation et décor | Les éléments compatibles sont réutilisables séparément ; les incompatibilités sont visibles. |
| P10 | Utiliser une application plein écran puis revenir | Rendu ralenti ou suspendu selon la politique retenue ; reprise et sessions correctes. |
| P11 | Changer d'écran, de résolution ou d'espace | Coordonnées et sélection restent justes sur les configurations déclarées supportées. |
| P12 | Naviguer sans souris ou avec animations réduites | Les sessions et actions essentielles restent accessibles et lisibles. |
| P13 | Importer un thème contenant une proposition d'action | Pas d'exécution implicite ; l'association relève de la configuration utilisateur. |

Exécuter les parcours pertinents sur Linux, macOS et Windows.
Décliner Linux par environnement d'affichage effectivement retenu.
Un test macOS ou une CI multiplateforme du template ne prouvent pas la
compatibilité du futur bureau.

## Mesures à définir

Compléter les scénarios par une composition utilisant collisions et déplacement :
sol, mur, pente, décollage et atterrissage selon les comportements retenus.
Vérifier les dépendances nécessaires, les associations scène/minimap/portrait,
la conservation des identifiants lors d'un export et l'absence de chargement
des systèmes exclus. Un changement de fréquence d'affichage ne doit pas modifier
la simulation attendue. Pour chaque comportement, annoncer s'il est récupéré,
adapté, réimplémenté, précalculé ou non supporté. Le mode ambiant peut simplifier
les comportements sans modifier les données canoniques conservées.

La matrice détaillée du [PoC OoT](architecture/game-transformation.md) fait foi :
pièce et matériaux, acteur animé, collision séparée, audio référencé et placements
traçables. Ajouter les essais négatifs : collision absente → pas de patrouille,
AABB de clic → aucune navigation implicite, matériau dégradé → fidélité signalée,
boucle non validée → lecture unique ou crossfade annoncé. Vérifier la conservation
des sources après simplification et la résolution des ressources partagées.

Tester chaque profil énergétique sur batterie et secteur, avec animation,
sans interaction, sous occlusion totale et avec une autre surface encore visible.
La suspension du diorama ne doit pas interrompre les sessions de travail.

Mesurer CPU, GPU, mémoire, énergie, latence d'interaction et temps de chargement
sur une machine et une scène documentées, avec écran et fréquence connus.
Séparer le coût décor/terminal de celui des commandes et agents exécutés.
Comparer un bureau statique, animé, masqué et un terminal actif.

Les objectifs initiaux « moins de 1–2 % », « moins de 500 ms » et
« moins de 16 ms » sont des hypothèses non vérifiées. Fixer les seuils seulement
après choix de la scène pilote et mesures reproductibles.
La stratégie audio, ses boucles et son comportement sous suspension restent
à spécifier avant les tests correspondants.

## Règle de décision

Réutiliser les tests et harnais des composants adoptés, puis ajouter les tests
aux frontières spécifiques : sélection session/personnage, interactions OS,
changement de thème et ingestion. Ne pas inventer de framework de test avant
la stack. Un résultat non exécuté doit rester indiqué comme tel.
