# Décisions techniques — prochaine session

Aucune stack produit n'est sélectionnée au 7 septembre 2026.
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
| Distribution | Une ou plusieurs applications ? Quelles versions minimales ? | Installation et fonctionnement des modes séparés sur les trois OS. |
| État local | Quoi sauvegarder : thèmes, associations, disposition, historique ? | Comportement de reprise défini avant de choisir un stockage. |
| Énergie et audio | Quand ralentir, suspendre ou couper le son ? | Mesures au repos, en animation, pendant le travail et sous occlusion. |
| Actions et imports | Quelle séparation entre données, scripts, commandes et autorisations ? | Un thème importé ne lance pas implicitement de commandes. |
| Observabilité | Quelles informations suffisent au diagnostic local ? | Diagnostic utile sans journaliser par défaut le contenu sensible du terminal. |

## Ordre de la prochaine discussion

La [transformation du jeu](architecture/game-transformation.md) retient désormais
la bibliothèque canonique, la conversion par scène et le diorama ambiant adapté.
La prochaine preuve est un PoC d'extraction OoT, candidat prioritaire : pièce,
acteur animé, collision, musique et placements avec références conservées.
Comparer les outils sur cette chaîne avant de choisir formats et stack.
La récupération par décompilation/recompilation reste une piste à évaluer.

1. Identifier l'entrée OoT et la scène de test, puis vérifier la chaîne d'extraction avec les outils existants.
2. Confirmer ou écarter OoT comme pilote après cette preuve ; SM64 et Sunshine restent des alternatives.
3. Comparer les bases de terminal et de bureau multiplateforme et définir le modèle de session.
4. Définir le premier parcours intégré, les budgets mesurables et le périmètre OS précis.
5. Sélectionner ensuite la stack minimale, le packaging et les vérifications.

Rust, wgpu, winit, parry3d, cpal, symphonia, glTF et un bundle `.scene`
sont des pistes héritées, pas des dépendances autorisées pour le produit.
La génération d'adaptateurs par IA est une piste ultérieure, pas un prérequis
pour commencer.

## Socle installé

Le blueprint apporte Node/npm, CTXRoute, Archify, Sensor et Code Review Graph
pour travailler dans ce dépôt. Ces outils ne constituent pas l'infrastructure
de l'application. Les versions et preuves d'installation figurent dans la
[note de reprise](session-handoff.md).

Les décisions acquises sont consignées dans
[ADR-0029](decisions/ADR-0029-product-framing.md).
Les choix techniques restent explicitement ouverts ; ne pas exécuter
`npm run initialize` avant leur résolution.
