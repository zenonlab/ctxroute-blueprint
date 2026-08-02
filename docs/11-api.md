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
| Catalog | recherche locale multi-alias, provenance, politiques fournisseurs et synchronisation autorisée |
| Library | œuvres ancrées par favoris, vues et préférences personnelles |
| Sources | cibles canoniques, santé, alternatives et migrations |
| Discovery | lancements bornés, candidates, preuves et propositions de domaines |
| Releases | annonces, sorties logiques, origines disponibles et résolution d'ouverture |
| Progress | observations et consolidation personnelle |
| Inbox | événements personnels dédupliqués, lecture et notifications |
| Admin | santé, jobs ciblés, utilisateurs et diagnostics sans écran global de favoris |
| Backups | lecture des manifests/essais de restauration et déclenchement d'une création/vérification ; aucune restauration live par URL |

## Routes V1 prévues

Les noms finaux sont figés par le contrat OpenAPI de la wave concernée.

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/session
POST   /api/v1/auth/password
POST   /api/v1/auth/reset-tokens/:token/consume
GET    /api/v1/admin/users
POST   /api/v1/admin/invitations
POST   /api/v1/admin/password-reset-tokens
PATCH  /api/v1/admin/users/:userId
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
GET    /api/v1/admin/metadata-provider-policies
PATCH  /api/v1/admin/metadata-provider-policies/:provider
GET    /api/v1/admin/backups
POST   /api/v1/admin/backups
POST   /api/v1/admin/backups/:backupId/verify

GET    /api/v1/library
GET    /api/v1/library/:mediaId
PATCH  /api/v1/library/:mediaId/preferences
GET    /api/v1/library/:mediaId/releases
POST   /api/v1/library/:mediaId/source-discoveries
GET    /api/v1/library/:mediaId/source-discoveries
GET    /api/v1/library/:mediaId/source-candidates
POST   /api/v1/source-candidates/:candidateId/resolve
POST   /api/v1/source-domain-proposals
GET    /api/v1/admin/source-domain-proposals
POST   /api/v1/admin/source-domain-proposals/:proposalId/resolve

GET    /api/v1/device-private-checks/due
POST   /api/v1/device-private-checks/:targetId/lease
POST   /api/v1/device-private-check-results

GET    /api/v1/releases/:releaseId/origins
POST   /api/v1/releases/:releaseId/resolve-open
GET    /api/v1/inbox
PATCH  /api/v1/inbox/:eventId

POST   /api/v1/account-exports
GET    /api/v1/account-exports/:exportId
DELETE /api/v1/account
```

`resolve-open` accepte éventuellement une origine déjà connue sélectionnée dans `Sources (N)`. Il renvoie uniquement une URL enregistrée et revalidée ; il n'accepte pas d'URL externe libre.

Les routes backup sont administrateur uniquement et placent un travail borné dans la file/commande d'exploitation. Elles ne prennent jamais un chemin de fichier fourni librement et ne restaurent jamais la base active. Une restauration de désastre reste une commande hors ligne sur l'hôte selon [Exploitation locale et sauvegardes](10-exploitation-locale.md).

Créer une découverte exige une œuvre déjà présente grâce à un favori actif. La réponse initiale renvoie `202 Accepted` avec un `discoveryRunId`; le travail fournisseur/connecteur continue en job. `resolve` sert à accepter ou rejeter une candidate ambiguë, jamais à ajouter une œuvre hors favoris.

Les routes auth suivent l'[ADR 0014](adr/0014-authentification-et-sessions.md). Export et suppression suivent l'[ADR 0015](adr/0015-cycle-de-vie-des-donnees.md). Les routes administrateur ne peuvent ni choisir un chemin hôte arbitraire, ni retourner hash de mot de passe, session, jeton ou favori personnel.

## Conventions de transport

- JSON UTF-8 et dates UTC RFC 3339 ; l'affichage localisé appartient au client ;
- identifiants opaques non séquentiels dans les URLs publiques ;
- `X-Request-Id` accepté s'il respecte le format borné, sinon généré par l'API et toujours renvoyé ;
- taille maximale générale 1 Mio ; `bookmark-batches` accepte au plus 500 événements et 2 Mio ; toute exception est explicite dans OpenAPI ;
- listes paginées par curseur opaque, ordre stable `(created_at, id)`, 50 éléments par défaut et 100 maximum ;
- filtres, recherche et tri sont bornés et validés par Zod ; aucune colonne ou expression libre n'est transmise au stockage ;
- réponse `202 Accepted` pour travail asynchrone avec identifiant et URL d'état, jamais attente d'un fetch tiers dans la requête Web ;
- contenu privé : `Cache-Control: no-store`; contenu catalogue partageable : ETag possible selon provenance et scope.

### Idempotence

`Idempotency-Key` est obligatoire pour lots favoris, réconciliations, résultats privés, découvertes, exports et déclenchements backup. La déduplication inclut propriétaire authentifié, installation éventuelle, route, clé et hash du corps.

- même clé et même corps : réponse métier initiale rejouée sans second effet ;
- même clé et corps différent : `409 IDEMPOTENCY_KEY_REUSED` ;
- clés conservées au moins 24 heures, davantage si le job correspondant peut encore être rejoué ;
- l'idempotence métier possède aussi une contrainte PostgreSQL : le cache HTTP seul ne constitue pas une preuve.

### Erreurs

Les erreurs utilisent une enveloppe stable, sans stack ni donnée brute :

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "La requête est invalide.",
    "requestId": "req_example",
    "fields": []
  }
}
```

Codes attendus : `400` syntaxe, `401` non authentifié, `403` action interdite, `404` ressource absente ou appartenant à un autre utilisateur, `409` conflit/idempotence, `413` taille, `422` validation métier, `429` limite avec `Retry-After`, `503` dépendance locale indisponible. Une ressource de Bob demandée par Alice renvoie la même forme et le même statut qu'une ressource inexistante lorsque cela évite une énumération.

### Compatibilité extension/API

L'extension envoie version, version de protocole et `installation_id` authentifié. Le diagnostic serveur expose `currentProtocol` et `minimumSupportedProtocol` sans secret.

- une fenêtre d'au moins une version de protocole permet de vider une file locale après mise à jour ;
- une version trop ancienne reçoit `426 UPGRADE_REQUIRED`, conserve sa file et affiche un diagnostic ;
- une version inconnue ou future ne déclenche aucune interprétation permissive ;
- toute migration de payload possède fixtures de l'ancienne et de la nouvelle version.

## Exemple de réponse d'une sortie

```json
{
  "releaseId": "rel_orbital_13",
  "state": "AVAILABLE",
  "label": "Épisode 13",
  "announcement": {
    "provider": "FIXTURE_CATALOG",
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

Le champ `state` suit ce contrat :

- `SCHEDULED` : horaire futur fourni par un calendrier autorisé ;
- `ANNOUNCED` : sortie déclarée par un fournisseur, ou horaire dépassé, mais aucune origine compatible n'a encore été validée ;
- `AVAILABLE` : au moins une `release_origin` validée existe.

Pour `SCHEDULED` et `ANNOUNCED`, `origins` est vide et aucun événement « disponible » n'est créé. L'interface peut afficher l'annonce et sa provenance, sans bouton « lire/regarder maintenant ».

## Jobs internes

Les workers utilisent des services métier partagés, pas des routes administrateur publiques :

- `catalog_search_authorized_provider` ;
- `catalog_refresh_media` ;
- `catalog_refresh_airing_window` ;
- `source_check_target` ;
- `source_discover_media` ;
- `source_validate_candidate` ;
- `release_reconcile` ;
- `notification_deliver` ;
- `cache_purge`.

Chaque job possède clé idempotente, nombre maximal d'essais, backoff, timeout et diagnostic. Les appels fournisseur et site ne restent jamais ouverts pendant une requête Web longue : l'API retourne l'état local et peut programmer un rafraîchissement.

Par défaut, la première origine compatible produit l'événement `RELEASE_AVAILABLE`. Une origine ultérieure enrichit la sortie sans nouvel événement. L'option personnelle `PREFERRED_ORIGIN_AVAILABLE` permet une seconde alerte lorsque la langue/source préférée arrive plus tard.

## Isolation

- session Web par cookie sécurisé ; extension par jeton d'installation à scopes réduits ;
- toute ressource personnelle est chargée avec `user_id` issu de l'authentification ;
- catalogue et disponibilité publics peuvent être partagés, jamais progression, favori ou préférence ;
- les erreurs ne retournent ni URL d'un autre utilisateur, ni données brutes de connecteur ;
- Zod valide les entrées et OpenAPI sert de contrat aux clients et tests.
- les conventions de transport, erreurs, pagination et idempotence sont testées depuis l'OpenAPI, pas seulement décrites.
