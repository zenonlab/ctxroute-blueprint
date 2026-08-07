# API fournisseurs et stack

## Matrice normative

| Type de donnée | Anime | Manga/manhwa/manhua |
|---|---|---|
| Identité canonique externe | AniList | MangaUpdates |
| Titres et synonymes | AniList | MangaUpdates `title` et `associated[]` |
| Fiche éditoriale | AniList | MangaUpdates |
| Calendrier/annonces | AniList airing | MangaUpdates releases |
| Couverture | AniList | AniList |
| Bannière | AniList | AniList fallback si association fiable |
| Progression personnelle | extension/utilisateur | extension/utilisateur |
| Disponibilité réelle | connecteur du site | connecteur du site |

Cette matrice est imposée par [ADR 0021](adr/0021-responsabilites-fournisseurs.md). Les données durables conservent fournisseur, version du connecteur, date, URL source, finalité, hash et attribution.

## Contrats live observés

### MangaUpdates

`POST https://api.mangaupdates.com/v1/series/search` accepte `{ "search": "Solo Leveling" }` sans clé. La réponse est paginée et utilise `results[].record`, avec notamment `series_id`, `title`, `description`, `image`, `type`, `year`, `genres` et `url`. Le parseur doit ignorer les champs hors politique, notamment l’image.

`GET /v1/series/{series_id}` fournit la fiche détaillée : `associated[]`, auteurs, éditeurs, publications, catégories, genres, statut, dernier chapitre et relations. Chaque famille est validée et persistée séparément.

`POST /v1/releases` exige un compte/API key. Un GET est une erreur de méthode ; un POST sans clé est `401 Unauthorized`. Aucun sweep n’est déclaré sain sans clé configurée.

### AniList

La recherche GraphQL légère sert au matching anime. Une seconde requête par ID charge le payload riche autorisé. Pour une œuvre de lecture déjà résolue par MangaUpdates, AniList ne peut être utilisé que pour les champs complémentaires et images explicitement autorisés ; il ne change jamais l’identité canonique.

## États et résilience

Chaque couple `(media, provider, purpose, connector_version)` possède son état, son fingerprint, ses essais, sa prochaine échéance et son erreur. Les erreurs HTTP, timeout, DNS, JSON/schema invalide, `429`, MIME, dimensions et décodage ne sont jamais converties en succès.

Les jobs fournisseur ont une gate PostgreSQL, un budget conservateur autorisé, un backoff et une clé idempotente. Les heartbeats ont une priorité supérieure aux enrichissements afin que la santé runtime reste observable pendant un backlog.

Les appels sont exécutés par lanes fournisseur partagées entre les processus worker. AniList et MangaUpdates disposent chacun d’un nombre maximal de requêtes simultanées (`max_in_flight=2` par défaut), ainsi que d’un espacement et d’un blocage global sur `429`. La concurrence Graphile peut donc être supérieure à la concurrence réseau d’un fournisseur sans dépasser la limite de sa lane.

## Assets privés

Les couvertures et bannières valides sont compressées en WebP et dédupliquées dans `catalog_image_asset`. Une route d’asset impose une session et l’existence d’un favori actif appartenant à l’utilisateur. Une consultation Web relit PostgreSQL et ne déclenche jamais directement un appel fournisseur.

## Stack

TypeScript strict, Fastify, React/Next.js, PostgreSQL, Drizzle, Graphile Worker, WXT Manifest V3 et Caddy TLS local. PostgreSQL reste source de vérité, cache durable et file de jobs ; aucun Redis n’est ajouté.
