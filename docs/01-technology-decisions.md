# Décisions techniques — prochaine session

Aucune stack produit n'est sélectionnée au 7 septembre 2026.
Une [architecture de référence à éprouver](architecture/runtime-infrastructure.md)
est documentée : responsabilités, hypothèses d'assemblage et alternatives.
Voir [ADR-0033](decisions/ADR-0033-runtime-boundaries-and-evaluation.md).
Le recadrage [ADR-0034](decisions/ADR-0034-theme-first-and-on-demand-discovery.md)
retire toute priorité à cet assemblage et à l'inventaire exhaustif : le produit
est le thème, l'IA prépare les dépendances manquantes à la demande.
La [vision produit](00-project-brief.md) prime sur les propositions techniques
de la [recherche initiale](research/initial-research.md).

## Principe de sélection

Commencer par les projets et composants existants, vérifier leurs capacités
réelles et ne développer que les liaisons ou fonctions manquantes.
Comparer adoption directe, extension et assemblage avant d'envisager une
réécriture. Ne pas confondre la stack du blueprint avec celle du produit.

Pour chaque candidat : source officielle et version examinée, maintenance,
licence, OS réellement supportés, personnalisation, qualité du terminal,
accès aux assets, consommation mesurée, coût d'intégration et limites.
Une recommandation doit être reliée à un parcours utilisateur et à une preuve.

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

La prochaine session porte sur l'architecture et l'infrastructure, après ce
cadrage documentaire. Elle peut comparer les composants sans ROM ; l'adoption
définitive des formats d'ingestion dépend cependant de la preuve d'extraction.
La séparation locale est acquise dans
[ADR-0032](decisions/ADR-0032-local-conversion-and-theme-distribution.md).

La [transformation du jeu](architecture/game-transformation.md) retient désormais
la bibliothèque canonique, la conversion par scène et le diorama ambiant adapté.
Une preuve d'ingestion possible reste le PoC OoT précédemment proposé : pièce,
acteur animé, collision, musique et placements avec références conservées.
Comparer les outils sur cette chaîne avant de choisir formats et stack.
Ce PoC n'est pas une condition pour commencer un thème original ni pour comparer
les technologies du terminal et du wallpaper.
La récupération par décompilation/recompilation reste une piste à évaluer.

1. Partir du package de thème : créer, installer, personnaliser et activer wallpaper et terminal séparément ou ensemble.
2. Comparer les solutions existantes sur ce parcours, puis les langages, formats et intégrations OS ; ne pas privilégier automatiquement l'assemblage antérieur.
3. Définir l'assistance IA de préparation : recherche publique, exécution locale isolée et chaîne reproductible, sans choisir un fournisseur prématurément.
4. Choisir le thème de preuve, le matériel et les budgets ; un thème original sans ROM suffit pour commencer la comparaison.
5. Éprouver les choix ; préparer un jeu à la demande si le thème en dépend, sans inventorier toutes les consoles ni décompiler un jeu complet au préalable.

Rust, wgpu, winit, parry3d, cpal, symphonia, glTF et un bundle `.scene`
sont des pistes héritées, pas des dépendances autorisées pour le produit.
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
Les choix techniques restent explicitement ouverts ; ne pas exécuter
`npm run initialize` avant leur résolution.
