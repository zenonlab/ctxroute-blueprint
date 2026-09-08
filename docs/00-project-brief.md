# Vision produit — bureau et terminal ludiques

État : PoC macOS 1 gelé, PoC macOS 2 spécifié, 8 septembre 2026. Nom de travail : Wallpaper.
Aucun moteur, terminal ou extracteur produit n'est encore implémenté.
Le dépôt est initialisé ; une [sonde native isolée](pocs/macos-surface.md) est implémentée.
Le [plan L1–L3](05-poc-start-plan.md) fixe le périmètre expérimental ;
Il ne constitue pas une adoption de production. Le PoC1 a fourni des preuves utiles
mais a trop divergé, notamment avec deux représentations de panneau. La nouvelle
[architecture des connecteurs](architecture/platform-connectors.md) et
[ADR-0049](decisions/ADR-0049-platform-connectors-and-macos-poc2.md) font foi.

Les audits sont consolidés dans la [synthèse sourcée](research/architecture-audit-synthesis.md).
Le [protocole expérimental](04-experimental-protocol.md) prépare les preuves avant
choix de stack ; aucun benchmark ni support OS n'est acquis par cette documentation.

## Synthèse

Le produit est un système de **thèmes pour wallpapers et terminaux personnalisés**.
Un thème peut être original ou réutiliser des ressources de jeu préparées
localement. Nous ne construisons ni catalogue exhaustif de consoles, ni émulateur,
ni service de décompilation universelle. La découverte assistée par IA intervient
à la demande pour préparer une dépendance manquante, pas pour afficher le thème.
Voir [ADR-0034](decisions/ADR-0034-theme-first-and-on-demand-discovery.md).

Direction précisée : [préparation IA et contrôleurs sélectifs](architecture/ai-prepared-behaviors.md).
L'IA prépare les connexions et adaptations pour des entrées 2D, 3D, hybrides ou
custom ; le runtime utilise le résultat validé sans LLM permanent. Réutiliser
les données utiles et adapter les comportements en priorité, porter une logique
originale seulement si nécessaire et isolable. Pas de garantie de conversion
universelle, ni de dépendance obligatoire à OoT ou à un moteur de jeu complet.

Priorité confirmée : minimiser l'énergie du wallpaper avant d'étendre les effets
et la personnalisation. Windows/macOS/Linux sont les familles visées, sans
promesse de parité universelle ; voir la [matrice de qualification](architecture/runtime-infrastructure.md#matrice-de-qualification-par-fonctionnalité)
et [ADR-0035](decisions/ADR-0035-platform-capabilities-and-energy.md).

Créer un environnement de travail personnel inspiré des jeux vidéo, dans lequel
un décor interactif et un terminal personnalisé forment une expérience cohérente.
L'objectif est de rendre le travail agréable et personnalisable, avec de vrais
terminaux et agents derrière les personnages et les objets cliquables.

L'utilisateur initial travaille avec plusieurs shells et agents de programmation.
Les « joueurs » représentent ces sessions, pas des utilisateurs distants ni une
fonction multijoueur. Un personnage est une représentation interchangeable :
son identité visuelle ne doit pas devenir l'identité technique de la session.

## Modes et modularité

Les créations sont portables ; les intégrations système ne le sont pas. Un contrat
commun décrit scène, objets, comportements, panneaux et intentions. macOS, Windows,
Wayland layer-shell, GNOME et X11 possèdent des connecteurs distincts qui annoncent
leurs capacités réelles. Aucun type de fenêtre ou permission OS ne fuit dans le thème.
Cette structure vise une expérience cohérente, pas une fausse parité universelle.

La [personnalisation](architecture/theme-customization.md) est un domaine distinct :
objets 2D/3D, rigs, animations, matériaux, sons et menus peuvent être importés et
composés. L'app connecteur conserve une UI native de permission/diagnostic ; l'UI du
thème est entièrement stylisable tout en gardant composants, focus et actions
sémantiques. Les boutons provisoires du PoC macOS ne définissent pas le design final.

Une étagère de contrôles fait partie du thème dès sa création, en haut à gauche par
défaut et entièrement stylisable : mute du thème, pause des animations, verrouillage
des interactions, profil énergétique, panneaux et réglages. La visibilité des fichiers
du bureau utilise la même intention dans tous les thèmes, mais reste une capacité du
connecteur OS avec état confirmé et récupération native. Elle n'est jamais appliquée
automatiquement au chargement.

Les [interactions programmables](architecture/theme-interactions.md) couvrent
objets, géométrie, boutons et panneaux : un objet ouvre une UI, ses contrôles
pilotent animations/effets et leurs résultats actualisent l'UI. Ces relations
sont composables, sans règles propres à un jeu dans le cœur. Les panneaux du
wallpaper fonctionnent sans terminal ; saisie, présentation et actions externes
restent conditionnées aux capacités OS et aux autorisations.

| Mode | Expérience attendue |
| --- | --- |
| Terminal seul | Un terminal utilisable comme outil de travail, avec thème et sélecteur de sessions, sans activer le bureau animé. |
| Bureau seul | Un décor interactif, des objets et des raccourcis, sans obligation d'utiliser le terminal personnalisé. |
| Ensemble intégré | Décor, terminal et sélecteur de joueurs se répondent dans une expérience commune. |

La fusion visuelle est souhaitée ; elle ne décide ni du nombre d'applications,
ni du nombre de processus, ni du packaging. Les modules doivent pouvoir évoluer
et être activés indépendamment. On veut pouvoir changer de jeu, de décor,
de personnage, de disposition ou d'ambiance sans reconstruire le produit.

## Parcours de référence

1. L'utilisateur choisit un thème inspiré de Mario Kart et ouvre deux terminaux,
   dont l'un exécute un agent. Des portraits de joueurs représentent les sessions,
   par exemple en haut à droite.
2. Il clique sur un portrait : le terminal correspondant devient accessible.
   La saisie clavier va au terminal uniquement lorsqu'il le choisit explicitement.
3. Il remplace le personnage d'une session : les commandes et le travail en cours
   continuent, sans recréer la session.
4. Il clique sur un objet configuré du décor pour ouvrir une session, une
   application ou une destination. L'objet reste distinct de l'action associée.
5. Il passe à un thème différent ou désactive le décor animé : il conserve
   l'accès à ses sessions de travail.

Mario Kart est un exemple de langage visuel, pas le premier jeu définitivement
retenu. La liste en haut à droite est une piste de disposition, pas une position
immuable. Le terminal doit rester lisible et utilisable : texte, sélection,
copier-coller, défilement, raccourcis et navigation clavier priment sur le décor.

## Données de jeu et personnalisation

L'extension à une bibliothèque couvrant le jeu entier reste possible, mais n'est
pas un préalable à la création d'un thème : préparer les dépendances nécessaires
à la demande, conserver les données récupérées, puis ne charger et exécuter
que le nécessaire. Le cœur doit être extensible à différents jeux ; les exemples
ne définissent pas ses règles. La composition par code prime sur un éditeur
grand public. Voir [transformation du jeu](architecture/game-transformation.md)
et [ADR-0030](decisions/ADR-0030-game-transformation.md).

La bibliothèque doit pouvoir conserver aussi collisions, relations entre
représentations et comportements compris. Une animation, une surface de
collision et une règle de saut sont trois choses distinctes. Leur récupération
dépend des formats et du code du jeu. La bibliothèque conserve les informations
récupérées ; le mode nominal diorama peut adapter les comportements. La fidélité
sensorielle recherchée et chaque approximation doivent être vérifiées et signalées.

La décision antérieure sur l'ingestion retient l'indexation globale, les exports progressifs par
scène, les capacités explicites et les profils énergétiques mesurables.
OoT est candidat prioritaire pour une preuve d'extraction, pas encore un jeu
pilote validé. Voir [ADR-0031](decisions/ADR-0031-canonical-library-and-capabilities.md).

L'ambition exprimée est de disposer des données du jeu et d'en isoler les éléments
pour les réutiliser : environnements, personnages, objets, textures, squelettes,
animations, sons, musiques et éléments d'interface lorsqu'ils sont disponibles.

Un asset est un élément réutilisable ; un thème en compose plusieurs avec une
présentation ; une session porte le travail ; une association relie la session
à un personnage ou une action à un objet. Ce vocabulaire décrit le produit,
pas un schéma de données ou une API déjà approuvés.

La couverture devra être démontrée par jeu, version et catégorie d'asset.
Importer une scène ne prouve pas que tous les personnages, animations, sons ou
comportements du jeu sont récupérables. Les dépendances entre éléments doivent
rester explicites pour éviter de promettre des échanges incompatibles.
Les possibilités de composition entre plusieurs jeux restent à étudier.

## Contraintes

- Linux, macOS et Windows font partie de la cible produit. Les versions minimales
  et environnements Linux supportés seront décidés après investigation.
- Le bureau doit préserver les icônes, les clics destinés aux applications,
  le focus et les usages normaux du système.
- La décoration doit consommer peu de ressources et pouvoir ralentir ou
  se suspendre. Les budgets seront mesurés sur du matériel identifié.
- Le runtime ne fait fonctionner ni émulateur ni jeu complet en arrière-plan ;
  il consomme les ressources préparées par un convertisseur local séparé.
- Le changement d'apparence ne doit pas interrompre le travail. La survie des
  processus à la fermeture complète ou au redémarrage est une décision distincte.
- Les actions système doivent correspondre aux associations configurées par
  l'utilisateur. Un asset importé ou un nom suggéré par IA n'autorise pas,
  à lui seul, l'exécution d'une commande.
- Réutiliser au maximum les composants existants. Toute création spécifique doit
  expliquer le manque concret de l'existant et son coût de maintenance.

## Décisions

Confirmé par l'utilisateur : expérience intégrée mais modulaire, terminal et
bureau utilisables seuls, sessions de terminaux et d'agents, personnalisation
des joueurs, isolation des données de jeu, cible des trois OS et priorité à
la réutilisation.

Pour démarrer, [ADR-0042](decisions/ADR-0042-bounded-poc-start.md) retient :

| Domaine | Décision expérimentale |
| --- | --- |
| Langage/runtime | Swift/AppKit pour la sonde OS indépendante ; Rust pour contrôleur et candidat de rendu |
| Frontend | Fenêtre native de diagnostic, puis wgpu/WGSL avec winit ; pas de toolkit complet maison |
| Backend | Aucun serveur ; états de sessions simulés en mémoire, sans PTY |
| Stockage | JSON de fixture original versionné ; sorties reconstructibles sous `dist/`, aucune donnée privée |
| Tests | Contrôleurs unitaires sans GPU, gestes natifs consignés, mesures B-R séparées des tests blueprint |
| Déploiement | Compilation/lancement locaux explicites sur MAC-01, aucun auto-start ni installateur |
| Observabilité | Compteurs et durées locaux bornés, aucun contenu de session ou capture privée |
| Sécurité | Contrôleurs relus compilés ; données bornées, pas de script tiers, réseau ou commande externe |
| Performance | Plafond animé initial 30 Hz, attente sans animation, pause manuelle ; baseline puis budgets comparatifs gelés |

Terminal/PTY, stockage durable, format public, packaging et isolation du code tiers
restent hors du périmètre initial. Versions et commandes doivent être qualifiées
lors de l'initialisation et de l'ajout du PoC concerné.
L1 est désormais cadré par [ADR-0043](decisions/ADR-0043-isolated-macos-surface-poc.md) :
Swift 6.3.2, SDK macOS 26.5, package SwiftPM autonome sans dépendance, XCTest,
avertissements de compilation bloquants et durée finie (60 secondes par défaut,
600 maximum). Cible de compilation macOS 14 ; seul MAC-01 sous 26.2 est disponible.
État en mémoire, compteurs sur stdout ; fichiers de build et snapshots de notre
vue sous `dist/pocs/macos-surface/` via le lanceur fourni. Sonde sans sandbox hostile, sans
chargement tiers, permission globale d'entrée ou modification des réglages système.
Ces choix sont désormais rattachés aux échéances E1–E6 de la
[feuille de route unique](03-product-roadmap.md), et non à une session indéfinie.
E1 doit consigner les choix nécessaires au périmètre expérimental avant code.
Aucun backend distant, compte utilisateur ou service cloud n'est demandé.
L'utilisateur fournit sa ROM et lance lui-même la conversion locale séparée.
Il peut demander à une IA de découvrir les outils publics pertinents, préparer
un adaptateur et piloter sa validation locale dans les permissions accordées.
Un thème déjà préparé fonctionne sans cette assistance ; les agents exécutés
dans les sessions de travail restent une fonction distincte.
Nous distribuons outils et recettes sans ROM ni assets extraits ; aucune donnée
de jeu n'est envoyée à nos services ou à une IA distante dans ce parcours.
Une bibliothèque persistante uniquement sur son disque reste l'hypothèse de
travail ; sa conservation/purge est à confirmer. Voir
[ADR-0032](decisions/ADR-0032-local-conversion-and-theme-distribution.md).

Voir les [questions techniques](01-technology-decisions.md) et la
[décision de cadrage](decisions/ADR-0029-product-framing.md).

## Critères de réussite

Pour cette étape : un socle CTXRoute installé, une documentation cohérente,
un schéma conceptuel validé et une note permettant de reprendre sans relire
la conversation. Une sonde expérimentale est disponible, sans stack de production
sélectionnée ni qualification complète du bureau.

Pour le futur produit : les trois modes sont utilisables, chaque joueur ouvre
la bonne session, changer d'apparence conserve le travail, les assets disponibles
sont recomposables et les interactions natives du bureau sont préservées.
Les preuves devront être établies sur Linux, macOS et Windows.

Les [scénarios d'acceptation](02-quality-strategy.md) sont des exigences à tester,
pas des fonctionnalités livrées. La [recherche initiale](research/initial-research.md)
et sa roadmap ne constituent ni une architecture approuvée ni un engagement
de délai.
