# Contrat et responsabilités de l'API

## Rôle

Fastify expose l'unique API métier FavLib sous `/api/v1`. Elle relie Web, extensions appairées, PostgreSQL et workers. Elle ne lit pas Chrome directement, ne sert aucun média et n'offre pas de proxy vers une URL arbitraire.

## Responsabilités

| Domaine | Ce que fait l'API |
|---|---|
| Auth | sessions Web, invitations, CSRF, révocation |
| Devices | codes d'appairage, jetons d'installation limités et révocables |
| Bookmarks | lots idempotents de candidats, réconciliation et suppressions |
| Classification | inspection, matching catalogue, score et file « À vérifier » |
| Catalog | recherche locale multi-alias, hydratation AniList et état de synchronisation |
| Library | œuvres ancrées par favoris, vues et préférences personnelles |
| Sources | cibles canoniques, santé, alternatives et migrations |
| Releases | annonces, sorties logiques, origines disponibles et résolution d'ouverture |
| Progress | observations et consolidation personnelle |
| Inbox | événements personnels dédupliqués, lecture et notifications |
| Admin | santé, jobs ciblés, utilisateurs et diagnostics sans écran global de favoris |

## Routes V1 prévues

Les noms finaux sont figés par le contrat OpenAPI de la wave concernée.

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/pairings
POST   /api/v1/device-sessions/exchange
GET    /api/v1/devices
DELETE /api/v1/devices/:installationId

POST   /api/v1/bookmark-batches
POST   /api/v1/bookmark-reconciliations
GET    /api/v1/classification/review
POST   /api/v1/classification/:candidateId/resolve

GET    /api/v1/catalog/search?q=...
GET    /api/v1/catalog/media/:mediaId
GET    /api/v1/catalog/health

GET    /api/v1/library
GET    /api/v1/library/:mediaId
PATCH  /api/v1/library/:mediaId/preferences
GET    /api/v1/library/:mediaId/releases

GET    /api/v1/releases/:releaseId/origins
POST   /api/v1/releases/:releaseId/resolve-open
GET    /api/v1/inbox
PATCH  /api/v1/inbox/:eventId
```

`resolve-open` accepte éventuellement une origine déjà connue sélectionnée dans `Sources (N)`. Il renvoie uniquement une URL enregistrée et revalidée ; il n'accepte pas d'URL externe libre.

## Exemple de réponse d'une sortie

```json
{
  "releaseId": "rel_orbital_13",
  "state": "AVAILABLE",
  "label": "Épisode 13",
  "announcement": {
    "provider": "ANILIST",
    "scheduledAt": "2026-08-03T18:00:00Z"
  },
  "origins": [
    {
      "originId": "origin_fixture_fr_13",
      "site": "fixture-anime",
      "language": "fr",
      "health": "HEALTHY",
      "checkedAt": "2026-08-03T18:17:00Z"
    }
  ]
}
```

Avant confirmation du connecteur, `state` vaut `SCHEDULED`, `origins` est vide et aucun événement « disponible » n'est créé.

## Jobs internes

Les workers utilisent des services métier partagés, pas des routes administrateur publiques :

- `catalog_search_and_hydrate` ;
- `catalog_refresh_media` ;
- `catalog_refresh_airing_window` ;
- `source_check_target` ;
- `release_reconcile` ;
- `notification_deliver` ;
- `cache_purge`.

Chaque job possède clé idempotente, nombre maximal d'essais, backoff, timeout et diagnostic. Les appels fournisseur et site ne restent jamais ouverts pendant une requête Web longue : l'API retourne l'état local et peut programmer un rafraîchissement.

## Isolation

- session Web par cookie sécurisé ; extension par jeton d'installation à scopes réduits ;
- toute ressource personnelle est chargée avec `user_id` issu de l'authentification ;
- catalogue et disponibilité publics peuvent être partagés, jamais progression, favori ou préférence ;
- les erreurs ne retournent ni URL d'un autre utilisateur, ni données brutes de connecteur ;
- Zod valide les entrées et OpenAPI sert de contrat aux clients et tests.
