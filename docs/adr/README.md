# Architecture Decision Records

Les ADR enregistrent les décisions structurantes de FavLib.

| ADR | Décision | Statut |
|---|---|---|
| [0001](0001-progression-contextuelle.md) | progression contextuelle sans modifier les favoris | accepté |
| [0002](0002-confidentialite-import.md) | préfiltrage local et modèle de confiance | remplacé par 0018 |
| [0003](0003-topologie-locale-tls.md) | topologie Caddy et HTTPS local | accepté |
| [0004](0004-mutualisation-sources.md) | clé de mutualisation contextualisée | accepté |
| [0005](0005-identite-sorties.md) | identité et ordre des sorties | accepté |
| [0006](0006-file-jobs.md) | Graphile Worker sans Redis | accepté |
| [0007](0007-versioning-waves.md) | versioning et validation des waves | accepté |
| [0008](0008-cache.md) | cache PostgreSQL multi-couche et contextualisé | accepté |
| [0009](0009-resolution-multi-source.md) | sélection, alternatives et migration de source | accepté |
| [0010](0010-catalogue-local-et-signaux-sortie.md) | catalogue local, alias et preuve de disponibilité | accepté |
| [0011](0011-decouverte-et-surveillance-sources.md) | découverte contrôlée, surveillance et notifications | accepté |
| [0012](0012-conformite-fournisseurs-metadonnees.md) | gate légale et rétention des fournisseurs de métadonnées | accepté |
| [0013](0013-surveillance-extension-privee.md) | planification best effort des sources privées par extension | accepté |
| [0014](0014-authentification-et-sessions.md) | comptes, sessions Web et appairage | accepté |
| [0015](0015-cycle-de-vie-des-donnees.md) | rétention, export, suppression et non-résurrection | accepté |
| [0016](0016-extension-favorite-opt-in-updates.md) | mise à jour opt-in des favoris depuis une page approuvée | accepté |
| [0017](0017-identite-source-et-couvertures.md) | identité par URL source et cache borné des couvertures | accepté |
| [0018](0018-inventaire-general-des-favoris.md) | inventaire HTTP(S) exhaustif et classification traçable | accepté |
| [0019](0019-hardening-reseau-notifications-api.md) | frontières réseau, batches ntfy et API privée | accepté |
| [0020](0020-mangaupdates-releases.md) | releases et état public MangaUpdates, calendrier séparé | accepté |
| [0021](0021-responsabilites-fournisseurs.md) | responsabilités canoniques AniList et MangaUpdates | accepté ; remplace partiellement 0010, 0012, 0017 et 0020 |
| [0022](0022-premier-resultat-et-limites-anilist.md) | résolution bornée et cadence AniList | accepté ; complété par 0024 |
| [0023](0023-review-interactive-correspondances-ambiguës.md) | review interactive et par-favori des correspondances ambiguës | accepté |
| [0024](0024-resolution-automatique-deterministe.md) | résolution automatique déterministe, OEL graphique et reprise terminale | accepté ; complète 0022 et 0023 |
