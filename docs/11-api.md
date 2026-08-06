# Contrat et responsabilités de l'API

## Rôle

Fastify expose l'unique API métier FavLib sous `/api/v1`. Elle relie Web, extensions appairées, PostgreSQL et workers. Elle ne lit pas Chrome directement, ne sert aucun média et n'offre pas de proxy vers une URL arbitraire.

## Responsabilités

| Domaine | Ce que fait l'API |
|---|---|
| Auth | inscription, sessions Web, CSRF, révocation |
| Devices | codes d'appairage, jetons d'installation limités et révocables |
| Bookmarks | lots idempotents de candidats, réconciliation et suppressions |
| Classification | inspection, matching catalogue, score et file « À vérifier » |
| Catalog | recherche locale multi-alias, provenance, politiques fournisseurs et synchronisation autorisée |
| Provider resolution | AniList pour anime et images ; MangaUpdates pour manga/manhwa/manhua |
| Library | œuvres ancrées par favoris, vues et préférences personnelles |
| Sources | cibles canoniques, santé, alternatives et migrations |
| Discovery | lancements bornés, candidates, preuves et propositions de domaines |
| Releases | annonces, sorties logiques, origines disponibles et résolution d'ouverture |
| Progress | observations et consolidation personnelle |
| Inbox | événements personnels dédupliqués, lecture et notifications |
| Review favoris | correspondances ambiguës par favori, candidats complets, décisions et audit |
| Admin | santé, jobs ciblés, utilisateurs et diagnostics sans écran global de favoris |
| Backups | lecture des manifests/essais de restauration et déclenchement d'une création/vérification ; aucune restauration live par URL |

## Routes V1 prévues

Les noms finaux sont figés par le contrat OpenAPI de la wave concernée.

```text
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/session
POST   /api/v1/auth/password
POST   /api/v1/auth/register
POST   /api/v1/auth/password-reset
GET    /api/v1/admin/users
PATCH  /api/v1/admin/users/:userId
POST   /api/v1/admin/users/:userId/revoke-sessions
POST   /api/v1/admin/users/:userId/password-reset
GET    /api/v1/admin/invitations
POST   /api/v1/admin/invitations
DELETE /api/v1/admin/invitations/:invitationId
GET    /api/v1/admin/settings
PATCH  /api/v1/admin/settings
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
GET    /api/v1/catalog/media/:mediaId/providers
GET    /api/v1/admin/provider-diagnostics
GET    /api/v1/admin/metadata-provider-policies
PATCH  /api/v1/admin/metadata-provider-policies/:provider
POST   /api/v1/admin/announcements
GET    /api/v1/admin/backups
POST   /api/v1/admin/backups
POST   /api/v1/admin/backups/:backupId/verify
POST   /api/v1/admin/backups/:backupId/restore-test
GET    /api/v1/admin/security/sessions
DELETE /api/v1/admin/security/sessions/:sessionId
GET    /api/v1/admin/security/events

GET    /api/v1/reviews
GET    /api/v1/reviews/:reviewId
POST   /api/v1/reviews/:reviewId/resolve
POST   /api/v1/reviews/:reviewId/manual
POST   /api/v1/reviews/:reviewId/no-match

GET    /api/v1/library?type=ANIME&type=MANGA&theme=Action&...
GET    /api/v1/library/facets?type=ANIME&theme=Action&...
GET    /api/v1/library/:mediaId
PATCH  /api/v1/library/:mediaId/preferences
GET    /api/v1/library/:mediaId/releases
GET    /api/v1/calendar?type=ANIME&category=airing
GET    /api/v1/calendar/feeds
POST   /api/v1/calendar/feeds              # label + filtres optionnels
POST   /api/v1/calendar/feeds/:id/regenerate
DELETE /api/v1/calendar/feeds/:id
GET    /api/v1/calendar/feeds/:id?token=…  # ICS privé, sans cookie
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

GET    /api/v1/admin/diagnostics
GET    /api/v1/admin/actions/preview
POST   /api/v1/admin/actions/metadata-retry
POST   /api/v1/admin/actions/anilist-cover-backfill
POST   /api/v1/admin/actions/cover-recompress
POST   /api/v1/admin/actions/purge-expired
POST   /api/v1/admin/reset
GET    /api/v1/admin/reset/preview

GET    /api/v1/extension/config
PATCH  /api/v1/extension/preferences
GET    /api/v1/extension/update-proposals
POST   /api/v1/extension/update-proposals/:proposalId/result
GET    /api/v1/public/extension-releases/:browser
POST   /api/v1/admin/extension-releases
```

`POST /auth/register` accepte exactement `{ email, password }` et crée directement un compte membre. L'adresse déjà utilisée est refusée ; l'administrateur peut ensuite gérer le rôle, l'activation et les sessions.

La bibliothèque accepte des paramètres répétés pour `type`, `theme`, `status`, `year`, `contentRating` et `demographic`. `format` et `language` restent des métadonnées de fiche mais ne font pas partie du contrat de filtre. Les valeurs d'une même catégorie sont combinées par OU et les catégories par ET. `status` expose exclusivement `Ongoing`, `Hiatus` et `Completed`; les libellés fournisseur complets restent dans `metadata_assertion`. Le tri reste unique (`inventory`, `title`, `type`, `year`, `release` ou `favorites`), et chaque page contient au plus 30 œuvres. Les facettes utilisent la même projection canonique que les résultats et ignorent uniquement leur propre catégorie lors du comptage. La provenance fournisseur reste disponible pour l'attribution, mais n'est pas une facette utilisateur.

Les diagnostics Admin sont en lecture seule et ne sondent pas les API tierces : leur connectivité reflète uniquement les dernières tentatives persistées. Le reset exige CSRF, une prévisualisation, l'e-mail exact de l'admin et `RESET`; il agit sur les données de l'appelant, conserve sa session, ses préférences et ses appareils appairés, puis invalide leurs reçus d'inventaire afin que l'extension réimporte son état local.

La projection catalogue respecte [ADR 0021](adr/0021-responsabilites-fournisseurs.md). Une œuvre de lecture expose son identité et sa fiche MangaUpdates même si AniList ne la connaît pas. Une œuvre anime expose AniList. L’état local provisoire reste retourné avec `enrichmentStatus` et `enrichmentError` lorsqu’aucun fournisseur canonique n’a encore confirmé l’œuvre. Une route Web ne déclenche jamais directement une recherche fournisseur.

Les réglages opérationnels sont décrits et bornés dans `@favlib/config`, surchargés dans `operational_setting`, attribués à leur auteur et audités. Protocoles, limites de taille de sécurité, redirections, quotas d'import, politique des mots de passe et règles SSRF restent versionnés et ne sont pas exposés à `PATCH /admin/settings`.

`resolve-open` accepte éventuellement une origine déjà connue sélectionnée dans `Sources (N)`. Il renvoie uniquement une URL enregistrée et revalidée ; il n'accepte pas d'URL externe libre.

Les routes backup sont administrateur uniquement et placent un travail borné dans la file/commande d'exploitation. Elles ne prennent jamais un chemin de fichier fourni librement et ne restaurent jamais la base active. Une restauration de désastre reste une commande hors ligne sur l'hôte selon [Exploitation locale et sauvegardes](10-exploitation-locale.md).

Créer une découverte exige une œuvre déjà présente grâce à un favori actif. La réponse initiale renvoie `202 Accepted` avec un `discoveryRunId`; le travail fournisseur/connecteur continue en job. `resolve` sert à accepter ou rejeter une candidate ambiguë, jamais à ajouter une œuvre hors favoris.

Les routes auth suivent l'[ADR 0014](adr/0014-authentification-et-sessions.md). Export et suppression suivent l'[ADR 0015](adr/0015-cycle-de-vie-des-donnees.md). Les routes administrateur ne peuvent ni choisir un chemin hôte arbitraire, ni retourner hash de mot de passe, session, jeton ou favori personnel.

### File de review des favoris

La résolution fournisseur ne choisit jamais automatiquement entre des candidats concurrents lorsque le matching exact et la variante parenthésée restent plausibles. Le worker détaille chaque candidat avant de créer la review et conserve le payload complet comme provenance d’audit. Une review est toujours attachée à un favori individuel, même lorsque plusieurs favoris partagent une œuvre provisoire.

`GET /api/v1/reviews/:reviewId` renvoie le favori, les candidats détaillés et deux recherches Google bornées par fournisseur, avec le titre entre guillemets et `site:anilist.co` ou `site:mangaupdates.com`. La résolution accepte `{ "candidateId": "uuid" }`; le candidat et la review doivent appartenir à l’utilisateur courant. Le corps manuel est `{ "provider": "anilist" | "mangaupdates", "id"?: "…", "url"?: "…" }` et l’URL doit appartenir au fournisseur annoncé. `no-match` ferme la review sans créer d’œuvre fournisseur.

Une résolution rattache uniquement `(user_id, installation_id, bookmark_id)`, passe le lien à `matched`, supprime la notification active et conserve review, candidats et payloads. La notification active est `FAVORITE_REVIEW_REQUIRED`, dédupliquée par review, avec `reviewId`, titre personnel et lien `/review/:reviewId`. Les workers n’émettent plus `FAVORITE_UNRESOLVED`; un échec sans candidat ouvre une review vide pour la recherche manuelle.

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

L'extension envoie version, version de protocole et `installation_id` authentifié. `GET /api/v1/extension/diagnostic` expose sans secret `inventoryTotal`, `inventoryDigest`, `recognizedCount`, `reviewCount`, `excludedCount`, `lastSyncAt` et `verifiedSyncAt`. `POST /api/v1/extension/reconcile` enregistre une synchronisation vérifiée uniquement lorsque compteur et empreinte concordent.

`GET /api/v1/extension/page-resolution` résout une URL active vers une œuvre favorite exacte ou une page de la même œuvre et renvoie seulement son état et sa progression. `POST /api/v1/extension/page-metadata` accepte uniquement des métadonnées structurées bornées provenant d'un domaine autorisé ; aucun HTML complet n'est accepté. `GET /api/v1/extension/report` distingue favoris et œuvres regroupées par type et par domaine.

Les imports comparent l'empreinte déjà persistée avant de réinitialiser une classification. `page-metadata` conserve un reçu `(device, media, page_key, fingerprint)` : un payload identique répond `unchanged: true`, sans nouvelle assertion ni job. Les routes `config`, `preferences` et `update-proposals` utilisent le jeton d'installation, jamais la session Web.

La prévisualisation `cover-backfill` est strictement locale et annonce `networkAccess: false` et `sourceDomainsQueried: false`. L’exécution programme ensuite AniList pour les anime et pour les œuvres de lecture déjà résolues par MangaUpdates lorsqu’une correspondance fiable existe. Elle n’utilise jamais une image pour résoudre une identité et ne lance aucun backfill pendant une migration ou un déploiement.

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
- `SCHEDULED` : sortie prévue par AniList ; `ANNOUNCED` : release observée par MangaUpdates ; `AVAILABLE` : au moins une `release_origin` validée existe. Une annonce n’est jamais une URL lisible.

`GET /api/v1/library/:mediaId/providers` expose progression, dernier chapitre/volume, dernière release, identifiants et provenance fournisseur.

Le calendrier personnel est construit depuis les projections `media_airing` (épisodes AniList) et `mangaupdates_release_observation` (releases MangaUpdates), uniquement pour les favoris de l'utilisateur. Les instants restent stockés en UTC et sont présentés dans son fuseau IANA. Les filtres `type` (`ANIME`, `MANGA`, `MANHWA`, `MANHUA`) et `category` (`airing`, `release`) sont optionnels. `from` inclusif et `to` exclusif bornent la fenêtre en instants ISO 8601 ; l'interface demande exactement la semaine affichée. Un épisode AniList garde une identité stable lorsque son horaire change. Une release MangaUpdates garde une identité logique par chapitre et volume : langue et groupe décrivent ses origines, sans dupliquer l'événement. Une release sans date fournisseur n'est pas inventée dans le calendrier.

Le worker calendrier utilise `provider_progress.next_attempt_at` comme waitlist durable. Les œuvres `FINISHED` ou `CANCELLED` sont terminales et ne produisent plus de requête calendrier. Une œuvre `HIATUS` sans prochaine diffusion est revérifiée après trente jours ; si `nextAiringEpisode` apparaît, elle passe immédiatement dans la priorité urgente. Les diffusions à moins de quarante-huit heures sont prioritaires, puis les œuvres `RELEASING`, les débuts futurs et enfin les états sans calendrier. Jusqu'à cent IDs dus sont coalescés en deux appels GraphQL de cinquante maximum ; les deux appels restent soumis à la lane AniList durable, à l'espacement de 2,1 secondes et aux en-têtes de quota/reset. Le flux global MangaUpdates ne lance aucune recherche série opportuniste : une release inconnue attend la pipeline d'identité dédiée au lieu de multiplier les appels ou de choisir le premier résultat.

Un flux ICS est créé explicitement, global ou filtré. Le token retourné une seule fois est opaque et seul son hash est stocké. La régénération invalide l'ancien token, la révocation rend le flux inaccessible, et aucun service de calendrier tiers n'est contacté.

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
