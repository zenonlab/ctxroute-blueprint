# Audit live des fournisseurs — 2026-08-03

## Portée

Audit read-only effectué contre les APIs officielles et l’instance locale. Aucun payload réel de favori, cookie ou secret n’est conservé dans Git.

## Résultats

| Test | Résultat |
|---|---|
| `GET https://favlib.home.arpa/api/v1/health` | `200`, build et schéma exposés |
| `GET /api/v1/calendar` depuis l’application authentifiée | `500`, comparaison PostgreSQL `text = uuid` |
| worker sous backlog AniList | devient unhealthy car les jobs heartbeat sont affamés |
| MangaUpdates `POST /v1/series/search` | `200`, enveloppe `results[].record` |
| connecteur actuel `mapMuSeries` | incompatible avec l’enveloppe, donc aucun résultat exploitable |
| MangaUpdates `GET /v1/series/{series_id}` | `200`, fiche détaillée et titres `associated[]` |
| MangaUpdates `GET /v1/releases` | `405`, mauvaise méthode |
| MangaUpdates `POST /v1/releases` | endpoint public utilisé par le worker |

La réponse de recherche observée contient titre, description, type, année, genres, URL et image. La fiche détaillée contient aussi titres associés multilingues, auteurs, éditeurs, publications, catégories, statut, dernier chapitre et relations. La présence technique d’un champ image MangaUpdates ne vaut pas autorisation de le conserver.

## Conclusion

Le catalogue de lecture actuel dépend à tort d’AniList. La Wave F2 doit d’abord rendre MangaUpdates fonctionnel et canonique. Les correctifs image ne doivent commencer qu’en Wave F3, après identité fiable. La panne calendrier et la santé worker relèvent de F1 et bloquent la validation de toute wave fournisseur.
