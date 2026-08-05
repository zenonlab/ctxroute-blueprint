# Roadmap FavLib

La roadmap est organisée par risque et par preuve de sortie, pas par fournisseur
isolé. Une wave ne peut être déclarée terminée que si son gate technique et son
gate de données sont tous deux satisfaits.

1. **F0 — Doctrine et contrats** : provenance, finalités fournisseur, schéma et diagnostics read-only. État : largement implémenté ; validation documentaire à maintenir.
2. **F1 — Runtime fiable** : API authentifiée, worker observable, leases, retries et healthchecks. État : implémenté dans le code ; smoke Docker et base locale à vérifier.
3. **F2 — Lecture canonique** : MangaUpdates pour manga/manhwa/manhua, type contrôlé, fiche et identifiants. État : fonctionnel mais pipeline de résolution encore à réaligner.
4. **F3 — Animé canonique** : AniList pour anime, matching source/personal borné, fiche riche différée et images séparées. État : implémenté et testé.
5. **F4 — Review et réparation** : candidats, causes visibles, décision utilisateur et réparation des snapshots sans changement de décision. État : code et migrations implémentés ; exécution sur la base de production locale à contrôler.
6. **F5 — Unification de résolution** : appliquer le même contrat de provenance, d’agrégation, de pagination et de décision au worker lecture. État : à faire.
7. **F6 — Migration et validation intégrale** : réconciliation catalogue, couverture, releases, backup/restore et smoke utilisateur. État : à faire après F5.

La spécification complète est dans [20-resolution-entites-fournisseurs.md](20-resolution-entites-fournisseurs.md) et les gates détaillés dans [07-waves-et-tests.md](07-waves-et-tests.md). Aucun dump ou préchargement global n’est planifié.
