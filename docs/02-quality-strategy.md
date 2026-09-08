# Stratégie qualité

## Gate du PoC macOS 2

Le PoC1 est gelé ; ses tests empêchent une régression historique mais ne constituent
pas le gate de la nouvelle application. Le PoC2 suit M2-01 à M2-11 définis dans
[sa spécification](pocs/macos-connector-poc2.md#critères-dacceptation).

La qualité est vérifiée en quatre niveaux : modèle pur et manifeste canonique ;
contrat commande/quittance et générations ; package/identités/cycle de vie ; gestes
macOS réels. Les clics programmatiques ne qualifient ni Finder, ni Spaces, ni Mission
Control. La revue visuelle doit confirmer qu'il n'existe qu'un panneau logique et
aucun plan de décor devant Finder.

Toute mesure énergétique additionne l'app connecteur, WallpaperAgent, l'extension et
les helpers. Elle rapporte le delta face au bureau natif, sur au moins cinq passes
après préchauffage. La permission refusée et la cible d'entrée inconnue font partie
du chemin nominal de test, pas uniquement des erreurs.

Après M2-01, la preuve [D1](pocs/theme-design-poc.md) ajoute seize critères portant sur
la fidélité du rig, le partage de ressources sans partage d'état, le menu stylé et
accessible, la chaîne bouton-animation-UI, les fallbacks, l'export sans asset privé
et l'invalidation énergétique. Elle vérifie aussi l'étagère système personnalisable,
les actions locales portables et l'état confirmé d'une capacité desktop simulée. Le
renderer n'est pas adopté avant cette scène représentative.

La CI macOS exécute les tests Swift isolés du PoC2 sans lancer le provider ou les
Réglages. Le gate local natif reste `bash pocs/macos-connector/build.sh` (app,
extension, catalogue Apple et signatures). `npm run verify` ne remplace aucun
de ces contrôles produit. Les tests de transport utilisent des signaux injectés,
inactifs par défaut, et ne réveillent pas une extension installée.

Gate L1 adopté : SwiftPM/XCTest pour configuration bornée, pause, animation et
reprise ; compilation native avec avertissements bloquants, puis smoke AppKit
à durée finie. Les gestes Finder restent une preuve manuelle distincte.
Voir [la fiche L1](pocs/macos-surface.md). Sensor n'a pas de parseur Swift qualifié ;
sa couverture lexicale ne remplace ni le compilateur ni ces tests.

Le [plan L1–L3](05-poc-start-plan.md) fixe les premiers tests : sonde OS native,
invariants de contrôleur Rust sans GPU, puis scène représentative. Bornes de
fixture et protocole d'états simulés sont des exigences à implémenter, non des
tests disponibles. L'absence d'instrument énergétique n'empêche pas un diagnostic
fonctionnel, mais interdit un verdict de sobriété.

Le socle et les tests d'état L1 sont vérifiés séparément. Les scénarios produit
ci-dessous restent à éprouver au-delà de cette sonde, sans validation automatique implicite.
La [feuille de route](03-product-roadmap.md#preuves-et-traçabilité) associe ces
scénarios à E2–E6. E1 fixe le banc et les règles ; les seuils comparatifs sont
gelés après baseline exploratoire, avant comparaison. E2 mesure
le wallpaper seul avant ajout du terminal personnalisé ou de l'ingestion IA.
Les [contrats et tests de remplacement](architecture/module-contracts.md)
ajoutent R01–R08 : cœur sans moteur, surfaces remplaçables, scène représentative,
relations synthétiques, caches reconstruisibles, versions/actions refusées,
sessions indépendantes et flux bornés. E1 examine les contraintes terminal/import ;
E2 les sonde avec des doubles sans construire les fonctions complètes.

## Vérification du socle

Les [tests A01–A08](architecture/ai-prepared-behaviors.md#preuves-ciblées-et-prochaine-étape)
qualifient contrôleurs 2D/3D/custom, trajectoires réelles, formation, récupération,
absence de LLM à l'activation, état inconnu et sécurité des sorties générées.
Fixtures originales et invariants indépendants du générateur ; tests prévus,
non exécutés. Mesurer les contrôleurs séparément du rendu et du terminal.

Le [protocole produit](04-experimental-protocol.md) détaille désormais B-R (rendu),
B-T (terminal), B-O (ancrage) et B-F (autonomie/pannes), en complément des P/R.
Il impose référence native, répétitions, métriques définies et comparaisons neutres.
Machines et budgets E1 restent à renseigner ; tous les essais produit sont prévus,
non exécutés. Voir aussi la [synthèse des audits](research/architecture-audit-synthesis.md).

Conserver les contrôles fournis par le blueprint : installation officielle,
configuration, CTXRoute, contrats documentaires, ADR, schémas Archify, cohérence,
Sensor et tests du template. Les tests du template vérifient l'outillage,
pas un produit desktop qui n'existe pas encore.

Commandes existantes : `npm run setup`, `npm run validate`,
`npm run verify`, `npm run archify:visual-check`.
Le PoC wallpaper natif ajoute
`bash pocs/macos-native-wallpaper/verify-package.sh <paquet.app>` : ce contrôle
post-build vérifie le périmètre du chemin, les identités et versions des deux
bundles, l'extension point Apple, l'identité des assets entre hôte et extension,
la miniature 480×270, les signatures et le seul
entitlement sandbox autorisé. Il ne lance ni l'hôte ni l'extension et ne prouve
donc pas le rendu dans WallpaperAgent.
Le parcours macOS sépare désormais quatre preuves : présence du provider dans
pluginkit, lancement XPC lors du chargement du catalogue, écriture du provider
dans `Index.plist` après sélection, puis création/rendu de la surface. Sur macOS
26.2, ne pas automatiser la sélection par `accessibilityPerformPress` : le panneau
Apple plante avant l'appel au renderer. Une sélection physique et la lecture
postérieure de `Index.plist` sont requises.
Le transport des commandes dispose d'une cinquième preuve distincte : le
compagnon n'affiche « appliqué par le wallpaper » qu'après réception d'une
quittance Darwin émise par l'extension ayant au moins une surface active. Ce
signal ne prouve ni une livraison garantie, ni un clic direct dans le décor,
mais interdit de confondre l'envoi avec une mutation rendue.
Le gate rejouable
`bash pocs/macos-native-wallpaper/verify-runtime.sh <paquet.app>` reste en
lecture seule et exige le chemin isolé exact, le provider enregistré, un seul
hôte et une seule extension provenant de ce paquet, la sélection persistante de
la scène, deux contextes du PID courant et cinq transitions appliquées. Les
codes 64/65 distinguent un appel invalide d'un chemin hors périmètre.
Les résultats réellement obtenus sont consignés dans la
[note de reprise](session-handoff.md).

## Scénarios d'acceptation produit

Les [épreuves I01–I10](architecture/theme-interactions.md#tranche-de-validation-et-limites)
ajoutent le parcours objet → panneau → bouton → animation/effet → retour UI,
la priorité des entrées, les cycles bornés, l'annulation, les permissions,
l'accessibilité et l'énergie par surface. Elles sont prévues, non exécutées.

Appliquer ces scénarios par environnement selon la
[matrice de qualification OS](architecture/runtime-infrastructure.md#matrice-de-qualification-par-fonctionnalité).
Ajouter aux preuves desktop : refus des permissions avec repli non interactif,
visibilité inconnue sans faux statut de suspension, verrouillage/veille/reprise,
redémarrage du Shell et masquage d'un seul écran. Documenter la configuration
exacte et l'énergie incrémentale face au bureau natif. Aucun résultat de cette
suite blueprint ne certifie une plateforme produit.

| ID | Situation | Résultat attendu |
| --- | --- | --- |
| P01 | Utiliser le terminal seul | Aucun bureau animé requis ; saisie, sélection, copier-coller, défilement et navigation clavier utilisables. |
| P02 | Utiliser le bureau seul | Décor et actions accessibles sans imposer le terminal personnalisé. |
| P03 | Ouvrir deux shells, dont un avec agent | Deux joueurs distincts ; chaque clic affiche la session correspondante. |
| P04 | Changer le personnage d'une session active | Même travail en cours ; aucune relance de processus provoquée par le changement visuel. |
| P05 | Changer le thème ou désactiver l'animation | Les sessions restent accessibles ; les associations restent cohérentes. |
| P06 | Cliquer sur une icône native ou une application | Aucune action du décor déclenchée par erreur ; focus et comportement natifs préservés. |
| P07 | Choisir un objet interactif du décor | Seule l'action configurée est demandée ; le clavier n'est reçu que par le panneau ou terminal explicitement focalisé. Aucun détournement global de saisie. |
| P08 | Importer des assets incomplets | Couverture et dépendances annoncées ; aucune promesse de récupération totale du jeu. |
| P09 | Recomposer personnage, animation et décor | Les éléments compatibles sont réutilisables séparément ; les incompatibilités sont visibles. |
| P10 | Utiliser une application plein écran puis revenir | Rendu ralenti ou suspendu selon la politique retenue ; reprise et sessions correctes. |
| P11 | Changer d'écran, de résolution ou d'espace | Coordonnées et sélection restent justes sur les configurations déclarées supportées. |
| P12 | Naviguer sans souris ou avec animations réduites | Les sessions et actions essentielles restent accessibles et lisibles. |
| P13 | Importer un thème contenant une proposition d'action | Pas d'exécution implicite ; l'association relève de la configuration utilisateur. |
| P14 | Installer l'application sans ROM ni convertisseur | Terminal et thèmes sans dépendance ROM utilisables ; thème de jeu indisponible avec diagnostic. |
| P15 | Convertir une entrée locale avec le réseau désactivé après installation des outils | Extraction et validation possibles pour l'adaptateur supporté ; aucune transmission de ROM, asset, dump ou capture. |
| P16 | Fermer le convertisseur puis activer un thème préparé | Aucune ROM ouverte, aucun convertisseur/émulateur permanent ; uniquement les ressources sélectionnées. |
| P17 | Exporter une recette partageable | Aucun asset extrait, code du jeu, ROM, chemin privé ou contenu de session embarqué automatiquement. |
| P18 | Fournir une version inconnue ou une référence manquante | Échec explicite ou capacités restreintes ; aucun téléchargement du jeu ni rapprochement silencieux. |
| P19 | Changer de recette utilisant des ressources partagées | Références locales cohérentes, dérivés invalidés si nécessaire, sessions préservées. |

Ces tests sont prévus, pas exécutés. Compléter P15 par observation des accès
réseau et audit des journaux ; un échec réseau seul ne prouve pas l'absence
de tentative d'envoi. La politique de stockage/purge locale reste à confirmer.

Compléments du banc d'essai [infrastructure](architecture/runtime-infrastructure.md) :

| ID | Situation | Résultat attendu |
| --- | --- | --- |
| P20 | Interrompre l'hôte de scène | Sessions et texte conservés ; erreur signalée, aucun redémarrage du shell causé par le décor. |
| P21 | Saturer la sortie PTY et déplacer rapidement le curseur | Texte ordonné, mémoire bornée/backpressure ; événements de survol fusionnables sans bloquer la saisie. |
| P22 | Envoyer une action non autorisée ou un message trop grand | Rejet à la frontière de contrôle, aucun accès direct du thème au PTY ou au shell. |
| P23 | Charger un thème 2D sans géométrie 3D | Affichage et interactions adaptés aux capacités ; aucune collision 3D fabriquée pour prétendre au support. |
| P24 | Demander une préparation IA pour un jeu absent de la cartographie | Recherche des dépôts publics à la demande ; rôles, versions, licences et limites documentés, sans refus dû à l'absence du jeu dans une liste. |
| P25 | Un dépôt découvert demande secrets, réseau ou commandes hors périmètre | Instructions traitées comme non fiables ; inspection et permissions, aucun octroi implicite à l'outil. |
| P26 | Un outil échoue ou aucun dépôt utile n'est trouvé | Budget d'essais borné et diagnostic honnête ; aucune capacité certifiée sans preuve ni envoi de traces privées au modèle distant. |
| P27 | Réactiver le thème avec une chaîne déjà validée | Réutilisation des dépendances/adaptateur sans IA ni nouvelle recherche ; versions modifiées déclenchent revalidation. |
| P28 | Partager le package de thème après préparation locale | Notre logique/créations et références présentes ; données et logique extraites du jeu restent séparées, caches privés non embarqués. |

Une référence d'émulateur ne valide aucun de ces scénarios. Publier la couverture
par système/jeu/version/adaptateur et capacité selon la cartographie des consoles.

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
