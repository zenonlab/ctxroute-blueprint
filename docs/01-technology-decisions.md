# Décisions techniques — expérimentation puis adoption

Aucune stack de production n'est sélectionnée au 8 septembre 2026.
Le [PoC macOS 1](pocs/macos-surface.md) est gelé. [ADR-0049](decisions/ADR-0049-platform-connectors-and-macos-poc2.md)
retient une architecture commune par contrat et des connecteurs natifs séparés.
Le [PoC macOS 2](pocs/macos-connector-poc2.md) utilise Swift/AppKit et Core Animation
pour isoler la preuve macOS ; ce choix n'adopte pas Swift comme cœur portable.
Le [plan de démarrage](05-poc-start-plan.md) sélectionne toutefois les outils des
PoCs : Swift/AppKit pour sonder macOS, Rust pour les contrôleurs, puis wgpu/WGSL
et winit pour le candidat de rendu. Ce choix borné remplace le report général
des décisions initiales ; voir [ADR-0042](decisions/ADR-0042-bounded-poc-start.md).
L'ordre actuel est la [feuille de route E1–E6](03-product-roadmap.md), selon
[ADR-0036](decisions/ADR-0036-evidence-first-roadmap.md). Depuis ADR-0035,
Rust/wgpu/WGSL est le candidat wallpaper prioritaire à éprouver, sans adoption
ni gain énergétique démontré. Les questions ci-dessous sont fermées aux échéances
de la feuille de route, pas toutes au cours d'une même session.
Une [architecture de référence à éprouver](architecture/runtime-infrastructure.md)
est documentée : responsabilités, hypothèses d'assemblage et alternatives.
Voir [ADR-0033](decisions/ADR-0033-runtime-boundaries-and-evaluation.md).
Le recadrage [ADR-0034](decisions/ADR-0034-theme-first-and-on-demand-discovery.md)
retire toute priorité à cet assemblage et à l'inventaire exhaustif : le produit
est le thème, l'IA prépare les dépendances manquantes à la demande.
La [vision produit](00-project-brief.md) prime sur les propositions techniques
de la [recherche initiale](research/initial-research.md).

## Principe de sélection

Direction de travail : développer notre runtime ciblé avec des bibliothèques
réutilisées. Un moteur de jeu complet n'est pas une dépendance par défaut ; Godot
est un repère historique hors shortlist active. Cette clarification ne constitue
pas encore une adoption de version wgpu, de langage ou de stack terminal.

Le [préflight OS](research/os-feasibility.md) relève MAC-01 et les obstacles natifs
avant sélection du moteur. La [revue de stack](research/stack-preflight.md) sépare
notre intégration des bibliothèques réutilisées, avec révisions repérées et limites.
Les branches de développement observées ne sont pas des versions adoptées.

La [synthèse contradictoire](research/architecture-audit-synthesis.md) référence
les dépôts candidats, leurs rôles réels et les conclusions non retenues des audits.
Le [protocole expérimental](04-experimental-protocol.md), adopté par
[ADR-0038](decisions/ADR-0038-neutral-experimental-protocol.md), cadre les preuves
avant adoption. Ni terminal natif, ni Wasm, ni vidéo ne sont imposés par l'audit.

Commencer par les projets et composants existants, vérifier leurs capacités
réelles et ne développer que les liaisons ou fonctions manquantes.
Comparer adoption directe, extension et assemblage avant d'envisager une
réécriture. Ne pas confondre la stack du blueprint avec celle du produit.

Pour chaque candidat : source officielle et version examinée, maintenance,
licence, OS réellement supportés, personnalisation, qualité du terminal,
accès aux assets, consommation mesurée, coût d'intégration et limites.
Une recommandation doit être reliée à un parcours utilisateur et à une preuve.

## Décisions de frontière après le PoC macOS 1

| Sujet | Décision actuelle | Reste ouvert |
| --- | --- | --- |
| Thèmes | manifeste canonique et contrat indépendant du langage/OS | schéma public final et format binaire éventuel |
| Plateformes | connecteur distinct pour macOS, Windows, Wayland layer-shell, GNOME et X11 | versions minimales et capacités qualifiées |
| macOS PoC2 | Swift 6, AppKit/Core Animation, app connecteur et adaptateur wallpaper séparés | transport XPC/App Group, API de distribution viable |
| UI | un panneau logique ; une seule présentation active | scène interactive ou app selon preuve d'entrée |
| Personnalisation | slots typés, styles sémantiques et assets privés résolus localement | formats pivots et outil de création final |
| Contrôles système | étagère sémantique stylable ; actions runtime portables et capacités OS négociées | mécanismes qualifiés de visibilité desktop par connecteur |
| Rigs | squelette, bind pose et compatibilité conservés et qualifiés | bibliothèque/algorithme de retargeting |
| Rendu partagé | interface d'hôte de scène sans type backend | wgpu, moteur existant ou assemblage spécialisé |
| Terminal | processus et cycle de vie indépendants | stack native ou WebView après benchmark |
| Entrée | passive par défaut, refus ouvert sur cible ambiguë | interaction directe par plateforme après test natif |

Le provider Apple utilisé par la preuve est privé et instable. Son fonctionnement
local ne suffit pas pour choisir le canal de distribution. Le bouton Finder
`CreateDesktop`, les notifications Darwin et les signatures ad hoc restent des
instruments de PoC, pas des technologies du produit.

Le choix du renderer sera évalué sur [D1](pocs/theme-design-poc.md), qui combine un
objet riggé, deux animations, quatre instances et une UI stylée. Un test sur triangle
ou les boutons AppKit du connecteur ne suffisent pas à sélectionner la stack graphique.

## Questions et preuves à obtenir

| Sujet | Décision ouverte | Preuve attendue |
| --- | --- | --- |
| Base produit | Étendre un terminal ou un moteur existant, ou assembler des composants ? | Démonstration des trois modes et inventaire de ce qui reste à écrire. |
| Terminal | Quel composant de terminal et quelle intégration PTY réutiliser ? | Saisie, TUI, couleurs, copier-coller, redimensionnement et raccourcis sur les trois OS. |
| Sessions et agents | Shells ordinaires, intégrations d'agents optionnelles, persistance ? | Sélection correcte, identité indépendante du thème, comportement à la fermeture documenté. |
| Thèmes et composition | Quelles parties sont interchangeables et avec quelles dépendances ? | Changement de personnage et de décor sans interruption du travail. |
| Bureau natif | Quelles solutions existantes fonctionnent pour chaque OS et compositeur ? | Focus, icônes, fenêtres au premier plan, espaces et multi-écrans testés. |
| Rendu et interaction | Quel moteur existant restitue les assets et permet les clics ? | Scène représentative, animations, sélection et coût mesuré. |
| Ingestion | Quel jeu et quelle version serviront de pilote ? Quels extracteurs ? | Inventaire réel des éléments récupérés et des catégories manquantes. |
| Formats | Réutiliser quels formats d'assets, scènes et thèmes ? | Hiérarchie, matériaux, animations, audio et références conservés. |
| Distribution | Convertisseur séparé acquis ; quels paquets et versions minimales ? | Application utilisable sans outil de conversion, recettes sans assets extraits, activation locale. |
| État local | Quoi sauvegarder : thèmes, associations, disposition, historique ? | Comportement de reprise défini avant de choisir un stockage. |
| Énergie et audio | Quand ralentir, suspendre ou couper le son ? | Mesures au repos, en animation, pendant le travail et sous occlusion. |
| Actions et imports | Quelle séparation entre données, scripts, commandes et autorisations ? | Un thème importé ne lance pas implicitement de commandes. |
| Observabilité | Quelles informations suffisent au diagnostic local ? | Diagnostic utile sans journaliser par défaut le contenu sensible du terminal. |

## Ordre de la prochaine discussion

La prochaine session exécute le plan L1–L3 après initialisation. Elle compare
les composants sans ROM ; l'adoption
définitive des formats d'ingestion dépend cependant de la preuve d'extraction.
La séparation locale est acquise dans
[ADR-0032](decisions/ADR-0032-local-conversion-and-theme-distribution.md).

La [transformation du jeu](architecture/game-transformation.md) retient désormais
la bibliothèque canonique, la conversion par scène et le diorama ambiant adapté.
Une preuve d'ingestion possible reste le PoC OoT précédemment proposé : pièce,
acteur animé, collision, musique et placements avec références conservées.
Comparer les outils sur cette chaîne avant de choisir les formats d'ingestion.
Ce PoC n'est pas une condition pour commencer un thème original ni pour comparer
les technologies du terminal et du wallpaper.
La récupération par décompilation/recompilation reste une piste à évaluer.

Suivre E1–E6 : banc et décisions initiales, ancrage/énergie sans ROM, contrat de
thème, terminal, qualification/distribution, puis ingestion assistée optionnelle.
Le détail et les critères de sortie vivent uniquement dans la feuille de route.

Rust/wgpu et winit sont retenus pour le candidat expérimental, pas pour la
production. parry3d,
cpal, symphonia, glTF et un bundle `.scene` restent des pistes à évaluer seulement
si l'étape les nécessite, pas une liste de dépendances à installer d'avance.
La découverte et préparation assistées par IA font partie du parcours optionnel
des thèmes dépendant d'un jeu ; elles ne sont pas requises pour afficher un thème
déjà préparé. Une génération de code n'est nécessaire que si l'existant ne suffit pas.

## Candidats évoqués, non adoptés

Cette liste archive la discussion et les sources consultées le 7 septembre 2026.
Aucun benchmark ou essai produit n'a été réalisé. Relever les révisions et
licences exactes lors de l'évaluation ; ce n'est pas une liste de dépendances.

| Besoin | Candidats et sources | Arbitrage à démontrer |
| --- | --- | --- |
| Terminal très personnalisé | [Tauri](https://v2.tauri.app/reference/webview-versions/) + [xterm.js](https://xtermjs.org/) + backend PTY, dont portable-pty à examiner | Réutiliser l'affichage terminal ; prouver saisie/TUI, IPC, sécurité et coût WebView sur chaque OS. Tauri ne résout pas seul l'ancrage wallpaper. |
| Terminal existant extensible | [WezTerm](https://wezterm.org/) | Comparer configuration/extension à l'effort d'une interface entièrement spécifique ; ne pas supposer qu'un HUD 3D arbitraire est configurable. |
| Wallpaper Windows | [Lively](https://github.com/rocksdanister/lively) | Évaluer adoption ou intégration ; ce n'est pas une solution multiplateforme démontrée. |
| Rendu commun | Moteur existant à comparer à la piste Rust/wgpu | Ne pas écrire un moteur maison avant d'avoir mesuré le manque et le coût des solutions existantes. |

### Émulateurs comme références hors ligne

Ces candidats peuvent servir à observer le jeu et comparer les résultats,
si leur plateforme et leur outillage conviennent. Ils ne sont ni installés
dans le produit ni nécessaires au runtime. Un jeu émulable n'est pas pour
autant convertible : la couverture dépend des lecteurs, versions et capacités.

La liste de référence est désormais la
[cartographie élargie](research/console-coverage.md), classée par constructeur,
extensions, systèmes spécialisés et limites. Elle remplace l'échantillon initial.
RetroArch est une interface à des cœurs : aucune API universelle d'extraction
de scènes, squelettes et comportements n'est déduite de ce catalogue.

### Personnalisation et réduction du code spécifique

La composition code la scène, caméra, personnages, portraits, disposition des
sessions, animations, sons, actions et profil énergétique. Les variantes peuvent
être configurables sans forker le runtime. Une session possède une identité
stable indépendante de sa représentation ; minimap et portrait utilisent les
relations du lecteur, pas une règle Mario Kart inscrite dans le cœur.

Priorité : réutiliser les lecteurs et composants terminal/rendu existants,
matérialiser les ressources à la demande, mutualiser la bibliothèque locale,
préparer les dérivés hors ligne et mesurer avant toute réécriture native.
Les permissions des scripts/actions et les thèmes utilisables sans ROM font
partie du parcours, pas des ajouts à repousser après l'intégration.

## Socle installé

Le blueprint apporte Node/npm, CTXRoute, Archify, Sensor et Code Review Graph
pour travailler dans ce dépôt. Ces outils ne constituent pas l'infrastructure
de l'application. Les versions et preuves d'installation figurent dans la
[note de reprise](session-handoff.md).

Les décisions acquises sont consignées dans
[ADR-0029](decisions/ADR-0029-product-framing.md).
Les choix de production restent ouverts. `npm run initialize` doit précéder
le code, après report et validation des décisions expérimentales L1–L3 ; ne pas
attendre le choix définitif du terminal ou du moteur pour initialiser ce périmètre.
