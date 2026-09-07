# Documentation du projet Wallpaper

Le projet est en cadrage produit. Le socle CTXRoute Blueprint est installé ;
le terminal, le bureau et l'ingestion restent à concevoir.
Le statut `template` persiste jusqu'à l'initialisation vérifiée avant code.
Le [plan de démarrage des PoCs](05-poc-start-plan.md) fixe les outils et le
périmètre initial : sonde macOS, contrôleur sans GPU, puis scène Rust/wgpu.

## Lecture de reprise

1. [Note de reprise](session-handoff.md) : état du dépôt et prochaine discussion.
2. [Vision produit](00-project-brief.md) : besoin confirmé et parcours.
3. [Décisions techniques ouvertes](01-technology-decisions.md) : comparer l'existant.
4. [Stratégie qualité](02-quality-strategy.md) : preuves et scénarios attendus.
5. [Concepts produit](architecture/product-vision.md) : relations sans stack imposée.
6. [Décision de cadrage](decisions/ADR-0029-product-framing.md) : décisions durables.
7. [Recherche initiale](research/initial-research.md) : synthèse archivée, non validée.

## Séparer produit et outillage

La [transformation du jeu et l'exécution sélective](architecture/game-transformation.md)
complètent la vision avec les dernières précisions : composition par code,
bibliothèque du jeu entier, collisions et comportements récupérables.
Les questions ouvertes figurent à la fin de ce document.

Les ADR antérieurs à ADR-0029 et les documents historiques sous `diff/`
décrivent le blueprint amont. Leurs preuves ne constituent pas des tests du produit.
Les guides et l'outillage sont conservés ; aucun nettoyage de starter n'est effectué.

Le schéma produit est une source Archify JSON versionnée. Le HTML est généré
dans `dist/architecture/` et n'est pas versionné.
Le [registre documentaire](document-contracts.json) déclare les sources et contrôles.

Avant tout code produit, poursuivre l'initialisation selon [AGENTS.md](../AGENTS.md)
avec les décisions expérimentales d'ADR-0042. Ne pas transformer les suggestions
de la recherche en choix acceptés.
