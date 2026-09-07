# Documentation du projet Wallpaper

Le dépôt est initialisé et la [sonde macOS L1](pocs/macos-surface.md) est implémentée.
Le terminal, le moteur de thèmes et l'ingestion restent à construire.
Les preuves de cette sonde ne qualifient pas encore un wallpaper produit.
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

Poursuivre selon [AGENTS.md](../AGENTS.md), ADR-0042 et ADR-0043 sans recommencer
l'initialisation. Ne pas transformer les suggestions de recherche en choix acceptés.
