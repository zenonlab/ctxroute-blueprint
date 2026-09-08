# Documentation du projet Wallpaper

Le dépôt est initialisé et le [PoC macOS 1](pocs/macos-surface.md) est désormais
gelé comme preuve expérimentale. Il a révélé une duplication de panneau et ne doit
pas devenir le produit par accumulation de correctifs.
La cible est maintenant un [cœur de thème unifié avec des connecteurs OS séparés](architecture/platform-connectors.md).
Le [PoC macOS 2](pocs/macos-connector-poc2.md) est spécifié mais pas encore implémenté.
Le terminal, le moteur de thèmes produit et l'ingestion restent à construire.
Le [plan de démarrage des PoCs](05-poc-start-plan.md) fixe les outils et le
périmètre initial : sonde macOS, contrôleur sans GPU, puis scène Rust/wgpu.

## Lecture de reprise

1. [Architecture des connecteurs](architecture/platform-connectors.md) : frontière cible commune/native.
2. [PoC macOS 2](pocs/macos-connector-poc2.md) : prochaine preuve bornée.
3. [Vision produit](00-project-brief.md) : besoin confirmé et parcours.
4. [Décisions techniques ouvertes](01-technology-decisions.md) : comparer l'existant.
5. [Stratégie qualité](02-quality-strategy.md) : preuves et scénarios attendus.
6. [PoC macOS 1](pocs/macos-surface.md) : résultats et limites historiques.
7. [Note de reprise](session-handoff.md) : état d'exécution local.

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
