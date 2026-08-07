# ADR 0021 — Responsabilités des fournisseurs

- Statut : accepté
- Date : 2026-08-03
- Remplace partiellement : ADR 0010, 0012, 0017 et 0020

## Décision

FavLib crée toujours une identité locale provisoire depuis un favori reconnu. Les fournisseurs ne créent jamais seuls une œuvre personnelle.

| Domaine | Source canonique | Données admises |
|---|---|---|
| Anime | AniList | identité, titres, synonymes, fiche, relations, calendrier, couverture et bannière |
| Manga, manhwa, manhua | MangaUpdates | identité, `series_id`, titre principal, titres `associated`, type, année, description, auteurs, éditeurs, publications, genres, catégories, statut, dernier chapitre, relations, releases et couverture |
| Progression personnelle | utilisateur/extension | observation issue du favori, d’une page consentie ou d’une action explicite |
| Disponibilité | connecteur de site | origine réellement lisible constatée sur la source favorite |

AniList et MangaUpdates possèdent chacun leurs lanes `metadata` et `cover`, avec états, cadence, cache et provenance indépendants. Ils peuvent s’exécuter en parallèle, mais une lane ne déclenche ni ne complète silencieusement celle de l’autre. Les couvertures locales restent durables et réutilisables.

## Résolution

Pour une œuvre de lecture, FavLib envoie les titres nettoyés à `POST /v1/series/search`. La réponse réelle enveloppe chaque résultat dans `results[].record`; le connecteur doit valider ce schéma. Toutes les fiches compatibles sont détaillées par `GET /v1/series/{series_id}`. Une seule fiche portant un titre normalisé ou compact exactement égal au titre `source` parsé est retenue automatiquement ; les doublons exacts et les rapprochements seulement approchants passent en review.

Pour un anime, AniList applique la même règle d’exact unique, tout en contraignant le type GraphQL à `ANIME`. AniList ne remplace ni une identité ni une couverture MangaUpdates.

Une œuvre reconnue mais non résolue reste visible sous son identité locale. Son diagnostic distingue `PENDING`, `NO_MATCH`, `AMBIGUOUS`, `RATE_LIMITED`, `UNAUTHORIZED` et erreur technique. L’absence d’enrichissement n’est jamais assimilée à l’absence de l’œuvre.

## Images

Une image est une lane indépendante de l’identité à l’intérieur de chaque pipeline fournisseur. Chaque tentative conserve fournisseur, URL source, identifiant externe, hash local, attribution, erreur et état. Une image locale active est toujours réutilisée avant un appel au même fournisseur. Une image non décodable, de MIME incohérent ou dangereuse reste refusée ; l’interface affiche alors un placeholder explicite.

## Releases et progression

MangaUpdates décrit l’état public de publication et les sorties annoncées. Le flux `/releases` exige une authentification et ne doit pas être planifié sans clé ni politique autorisée. Il ne modifie jamais la progression personnelle. Seul un connecteur de site crée une disponibilité `AVAILABLE`.

## Conséquences

- connecteurs et états d’enrichissement distincts par finalité ;
- aucune fusion pilotée par une image ;
- provenance champ par champ et purge par fournisseur ;
- diagnostics et tests contractuels fondés sur les enveloppes live observées ;
- migration nécessaire pour les identités de lecture actuellement pilotées par AniList.
