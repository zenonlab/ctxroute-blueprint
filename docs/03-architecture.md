# Architecture multi-utilisateur locale

## Contrainte structurante

Le serveur local ne peut pas lire directement les favoris Google de plusieurs personnes. L'API `chrome.bookmarks` ne voit que le profil Chrome dans lequel l'extension est installée. Chaque utilisateur doit donc installer et appairer sa propre extension.

Les identifiants Chrome de favoris sont uniques dans le profil courant, mais ne sont pas une identité globale fiable entre plusieurs appareils. FavLib utilise une observation par installation puis déduplique au niveau utilisateur avec l'URL normalisée, le site, l'œuvre et le chemin de dossier comme indice faible.

## Vue d'ensemble

```text
Utilisateur A / profil Chrome A          Utilisateur B / profil Chrome B
  favoris + extension appairée             favoris + extension appairée
              │ HTTPS                                  │ HTTPS
              └──────────────────┬──────────────────────┘
                                 ▼
                       Reverse proxy local HTTPS
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
          Web app Next.js                 API Fastify
                                               │
                 ┌─────────────────────────────┼────────────────────┐
                 ▼                             ▼                    ▼
            PostgreSQL                   Workers planifiés     fournisseurs / sites
     utilisateurs + catalogue      catalogue + vérifications  autorisés/connecteurs
```

## Principe de mutualisation

Les données utilisateur et les données de disponibilité ne suivent pas le même niveau de partage :

```text
source_target public + URL canonique
  └─ vérifié une seule fois par cycle
      ├─ abonnement utilisateur A → progression A → inbox A
      └─ abonnement utilisateur B → progression B → inbox B
```

Une page publique identique suivie par plusieurs comptes est récupérée une seule fois. Les favoris, positions, statuts et notifications restent personnels. Une source nécessitant une session utilisateur n'est pas récupérée par le worker commun ; seul un connecteur local d'extension peut fournir des métadonnées minimales, sans transmettre les cookies.

Cette vérification privée est best effort : l'extension utilise des alarmes recréées au démarrage, un lease serveur et une file hors ligne idempotente. Le serveur distingue appareil hors ligne, permission manquante, authentification expirée et cible réellement cassée ; voir [ADR 0013](adr/0013-surveillance-extension-privee.md).

La clé exacte de mutualisation est `(connector_id, connector_version, canonical_check_url, locale, region, access_mode, representation_variant)`. Elle est définie par [ADR 0004](adr/0004-mutualisation-sources.md).

## Composants

### Application Web

- Next.js, React et TypeScript.
- shadcn/ui et Tailwind CSS.
- écrans bibliothèque, œuvre précise, inbox, tri, sources, utilisateurs et diagnostics.
- session Web via cookie `HttpOnly`, `Secure` et `SameSite`.

### API

- Fastify, TypeScript, Zod et OpenAPI généré.
- modules Auth, Users, Devices, Bookmark Ingestion, Classification, Catalog, Library, Sources, Source Discovery, Source Resolver, Cache, Releases, Progress, Notifications et Admin.
- contrôle d'accès systématique par `user_id`, jamais uniquement dans l'interface.

### Extension

- WXT, React et Manifest V3.
- API Chrome Bookmarks et service worker.
- content scripts uniquement sur les domaines autorisés.
- file hors ligne persistante dans `chrome.storage.local`, explicitement considérée comme non chiffrée ; elle ne contient que des événements minimaux et des jetons opaques à portée limitée.
- budget total FavLib de 5 Mio sous le quota Chrome de 10 Mo, sans `unlimitedStorage`; toute écriture rejetée déclenche un diagnostic et une réconciliation, jamais un succès fictif.
- import complet, événements temps réel et réconciliation périodique.
- popup contextuelle sur la page précise.
- storage versionné/migré atomiquement sur mise à jour et protocole extension/API négocié pendant une fenêtre de compatibilité.

Au moment de l'appairage, l'utilisateur fournit l'origine du serveur local, idéalement au moyen d'un lien ou QR contenant origine + code court. L'extension demande à l'exécution une permission d'hôte limitée exactement à cette origine, puis toutes les communications API partent de son service worker.

### Worker

- jobs persistants dans PostgreSQL avec Graphile Worker ;
- résolution AniList des anime et résolution MangaUpdates des œuvres de lecture ;
- enrichissement éditorial strictement séparé de l’enrichissement image ;
- AniList fournit les images après résolution d’identité ;
- import des annonces de diffusion anime ;
- verrou par cible canonique et domaine ;
- limites par domaine, jitter et backoff ;
- fan-out des nouvelles sorties vers les abonnements personnels ;
- pas de Redis en première version.

### Stockage et accès local

- PostgreSQL pour toutes les données métier et files persistantes ;
- Docker Compose pour reverse proxy, web, API, worker et base ;
- reverse proxy Caddy à l'origine configurable, par défaut `https://favlib.home.arpa` ;
- routage même origine : `/api/*` vers Fastify et le reste vers Next.js ;
- HTTPS obligatoire dès que le service est utilisé par plusieurs machines du réseau local ;
- inscription normale locale ; l'administrateur gère les rôles, l'activation et les sessions.

## Appairage d'une extension

```text
utilisateur connecté au Web
  → crée un code à usage unique, valable quelques minutes
  → extension envoie code + installation_id + clé publique/appareil
  → API rattache l'installation au user_id
  → retourne des jetons courts et révocables
  → première synchronisation
```

Chaque installation possède ses propres identifiants et peut être révoquée sans déconnecter les autres appareils. Aucun compte Google n'est utilisé pour authentifier FavLib.

Le service worker MV3 est jetable : chaque événement persiste son intention avant l'appel réseau et aucune variable globale ne porte une vérité métier. Une alarme coarse demande les échéances privées au serveur. Pour une page authentifiée, l'observation d'un onglet ouvert est distincte d'un fetch d'arrière-plan validé site par site ; sans l'un ou l'autre, l'état est `WAITING_FOR_VISIT`, jamais « aucune nouveauté ».

## Synchronisation robuste des favoris

Les événements Chrome seuls ne suffisent pas : le service worker peut être suspendu et un appareil peut rester hors ligne.

FavLib combine :

1. un snapshot complet examiné localement au premier appairage ;
2. `onCreated`, `onChanged`, `onMoved` et `onRemoved` en temps réel ;
3. une file locale avec `client_event_id` idempotent ;
4. une réconciliation complète au démarrage, puis périodiquement ;
5. un fingerprint de snapshot pour détecter les événements manqués.

Les lots sont acquittés par le serveur. Une reprise renvoie le même lot sans créer de doublon.

Après le premier import, la réconciliation utilise deux phases :

1. l'extension compare tous les identifiants et fingerprints HTTP(S) dans le profil courant ;
2. elle transmet les créations, changements, déplacements et suppressions par lots idempotents ;
3. l'API conserve l’état courant minimal et classe chaque favori `recognized`, `review` ou `excluded`.

Un fingerprint local évite de retransmettre inutilement un état inchangé, mais ne constitue jamais une gate d’inventaire. Si la version du classifieur change, l’API peut reclasser l’inventaire durable sans perdre les favoris exclus ou à vérifier.

## Arborescence cible

```text
FavLib/
  apps/
    web/
    api/
    worker/
    extension/
  packages/
    ui/
    contracts/
    database/
    auth/
    bookmark-classifier/
    connectors/
    source-discovery/
    metadata-anilist/
    catalog-core/
    test-kit/
    config/
  fixtures/
    bookmarks/
    catalog/
    discovery/
    sources/
  docs/
  infra/
    compose.yaml
    Caddyfile
```

## Modèle de données

### Identité et appareils

| Entité | Rôle |
|---|---|
| `app_user` | compte local et rôle ; évite le mot spécial PostgreSQL `user` |
| `invitation` | création fermée d'un compte |
| `password_reset_token` | récupération locale, hachée, expirante et à usage unique |
| `user_session` | session Web opaque hachée, expirante et révocable |
| `device_installation` | extension appairée et révocable |
| `pairing_code` | secret court, haché et expirant |
| `device_token` | session d'extension à portée limitée |
| `security_event` | audit borné sans secret ni URL personnelle |
| `deletion_tombstone` | empêche la résurrection après restauration |
| `account_export` | manifest et état d'un export personnel temporaire |

### Favoris et classification

| Entité | Rôle |
|---|---|
| `bookmark_observation` | favori vu par une installation donnée |
| `bookmark_identity` | favori logique dédupliqué pour un utilisateur |
| `classification_run` | décision, score, raisons et version du classifieur |
| `bookmark_media_link` | relation personnelle entre favori et œuvre/source |
| `favorite_review` | file de décision personnelle, une ligne par favori et fournisseur |
| `favorite_review_candidate` | candidats détaillés et payloads fournisseur conservés pour audit |
| `candidate_staging` | candidat serveur minimal, purgé sous 24 heures s'il est ignoré |

La clé d'observation inclut `(user_id, installation_id, chrome_bookmark_id)`. Elle évite toute collision entre profils.

### Résolution interactive

```text
favori HTTP(S)
  → identité locale provisoire
  → recherche AniList/MangaUpdates
  → plusieurs candidats plausibles ou aucun résultat
  → favorite_review PENDING + FAVORITE_REVIEW_REQUIRED
  → /review/:reviewId
       ├─ candidat choisi → favori concerné MATCHED
       ├─ identifiant/URL fournisseur vérifié → même résolution
       └─ aucun ne correspond → NO_MATCH sans média incorrect
```

Le titre du navigateur reste une donnée personnelle du favori. Le titre canonique affiché dans la carte candidat vient du fournisseur ; les variantes et `hit_title` sont affichés séparément. Les autres candidats restent conservés après résolution.

### Bibliothèque et disponibilité

| Entité | Rôle |
|---|---|
| `media` | œuvre canonique FavLib, indépendante d'un utilisateur |
| `media_title` | titre natif, romaji, traduit ou synonyme avec langue/provenance |
| `external_id` | identifiant AniList, MAL, éditeur ou autre |
| `media_relation` | saison, suite, préquelle, adaptation ou side story |
| `source_media_alias` | titre/slug propre à un connecteur, après validation |
| `catalog_sync_state` | checkpoint, fraîcheur et état par fournisseur |
| `metadata_provider_policy` | autorisation, finalités, rétention et purge par fournisseur |
| `dataset_release` | version, licence revue et statut d'une livraison téléchargeable |
| `dataset_artifact` | URL, format, taille, checksum et validators d'un fichier |
| `dataset_import_run` | checkpoint, mapper, compteurs et activation atomique d'un batch |
| `provider_record` | record fournisseur brut utile, hash et batch actif |
| `metadata_assertion` | valeur normalisée et provenance champ par champ |
| `dataset_reject` | record invalide mis en quarantaine avec raison bornée |
| `library_item` | statut personnel de l'œuvre |
| `source_site` | domaine et capacités d'un connecteur |
| `source_target` | connecteur/version/URL/locale/région/mode/variante à vérifier |
| `user_subscription` | suivi personnel d'une cible favorite, épinglée ou fallback accepté |
| `user_source_preference` | langue, source/groupe épinglé et politique de fallback |
| `source_domain_proposal` | domaine proposé par un membre et décision administrateur |
| `source_discovery_run` | motif, initiateur, budget, checkpoint et diagnostic |
| `source_alias` | migration ancienne → nouvelle cible avec preuve |
| `source_health` | succès, erreurs, fraîcheur et quarantaine |
| `source_candidate` | alternative avec état, score, raisons et scope public/personnel |
| `source_candidate_evidence` | preuves versionnées d'inspection et de matching |
| `source_snapshot` | résultat minimal d'une vérification |
| `release` | chapitre ou épisode normalisé |
| `release_announcement` | sortie planifiée/annoncée par un fournisseur |
| `release_origin` | disponibilité d'une sortie sur une cible |
| `progress_observation` | position extraite d'un favori |
| `user_progress` | progression personnelle consolidée |
| `check_run` | diagnostic d'une vérification |
| `notification_event` | événement personnel dédupliqué |

### Cache

| Entité | Rôle |
|---|---|
| `metadata_cache` | réponses d'un fournisseur autorisé, TTL, politique et provenance |
| `source_inspection_cache` | canonicalisation et type de page contextualisés |
| `source_snapshot` | dernier état valide et validators HTTP |
| `negative_cache` | échec temporaire court avec raison |

Les caches PostgreSQL n'ajoutent pas de copie média. Les clés, TTL et invalidations sont définis par [ADR 0008](adr/0008-cache.md).

Le catalogue canonique, ses alias et la séparation annonce/disponibilité sont définis par [ADR 0010](adr/0010-catalogue-local-et-signaux-sortie.md).
La gate d'autorisation et de rétention des fournisseurs est définie par [ADR 0012](adr/0012-conformite-fournisseurs-metadonnees.md).
Les dumps retenus, leur fraîcheur et leur pipeline d'import sont définis dans [Jeux de données, dumps et imports locaux](13-jeux-de-donnees-et-imports.md).

## Flux catalogue et matching

```text
favori candidat
  → extraction titres + indices connecteur
  → recherche dans media_title/source_media_alias
  → candidats classés par alias + type + année + relations + source
  → identité locale visible
  → anime : résolution AniList
  → manga/manhwa/manhua : résolution MangaUpdates
  → match fort, À vérifier ou unmatched
  → planification du prochain catalog_refresh
```

Le rendu Web et les imports interrogent PostgreSQL. Un dump passe par staging, assertions avec provenance et activation atomique ; il n'écrit jamais directement dans `media`. Une œuvre reconnue reste affichée sous son identité locale si le fournisseur canonique est indisponible ou si le match est ambigu. Chaque appel externe exige la politique autorisée correspondant à sa finalité. Une image ne participe jamais au matching.

## Flux de découverte

```text
œuvre favorite + trigger autorisé
  → autres favoris personnels
  → liens catalogue
  → discover() des connecteurs actifs
  → recherche optionnelle dans les domaines approuvés
  → hints DISCOVERED
  → contrôles réseau + inspect()
  → matching canonique
  → VERIFIED / NEEDS_REVIEW / REJECTED / PENDING_CONNECTOR
  → affichage Sources (N)
  → abonnement seulement après épinglage ou fallback accepté
```

La découverte ne tourne pas à chaque vérification. Un domaine sans connecteur reste en attente de sa sous-wave et ne devient pas une cible surveillée. Voir [ADR 0011](adr/0011-decouverte-et-surveillance-sources.md).

Une même URL canonique découverte par plusieurs méthodes produit une candidate unique par contexte complet ; les preuves sont ajoutées séparément. Les scopes public et privé restent distincts.

## Flux de disponibilité

```text
scheduler
  → source_target due
  → verrou cible + limite domaine
  → connecteur
  → validation du résultat
  → diff avec dernier snapshot valide
  → transaction releases
  → fan-out user_subscription
  → regroupement release_origin
  → résolution préférence/fallback
  → inbox/notification par utilisateur
```

Les diffusions AniList pour les anime et les releases MangaUpdates pour les œuvres de lecture alimentent seulement les `release_announcement`. Les connecteurs des pages favorites doivent confirmer une `release_origin` avant toute disponibilité ou notification de disponibilité.

Au clic sur « Ouvrir », l'API résout à nouveau les origines compatibles afin d'éviter un lien obsolète. La stratégie complète est définie par [ADR 0009](adr/0009-resolution-multi-source.md).

## Isolation et sécurité

- toutes les requêtes personnelles sont filtrées côté API par l'identité authentifiée ;
- tests automatiques de non-fuite entre deux tenants ;
- l'administrateur gère les comptes mais l'interface n'affiche pas le contenu des favoris personnels ;
- l'administrateur système de l'hôte est explicitement dans le périmètre de confiance et peut techniquement accéder aux volumes ;
- les candidats serveur ignorés et leurs données lisibles sont purgés sous 24 heures et exclus des sauvegardes applicatives ;
- aucun cookie ou secret de site tiers n'est stocké ;
- SSRF bloqué, redirections revalidées et IP privées interdites pour les URLs distantes non approuvées ;
- tailles, délais et fréquence réseau limités ;
- HTML non fiable, scripts non exécutés côté serveur ;
- jetons d'appareil hachés, courts, rotatifs et révocables ;
- sessions Web, bootstrap et appairage conformes à [ADR 0014](adr/0014-authentification-et-sessions.md) ;
- rétention, export, suppression et tombstones conformes à [ADR 0015](adr/0015-cycle-de-vie-des-donnees.md) ;
- journaux sans URL complète lorsque celle-ci peut contenir une donnée sensible ;
- sauvegardes chiffrées par une clé administrateur hors dépôt, avec restauration testée par wave.

## Stack cible

- pnpm workspaces + Turborepo ;
- Next.js/React/TypeScript ;
- Fastify + Zod ;
- PostgreSQL + Drizzle ORM ;
- WXT pour Chromium puis Firefox ;
- Vitest, Playwright et fixtures versionnées ;
- Docker Compose + Caddy `tls internal` ;
- Graphile Worker ;
- versions stables exactes figées au scaffold.

La liste des dépendances directes reste courte et contrôlée. Chaque nouveau package doit justifier son besoin, sa licence, sa maintenance, son poids client et son comportement côté serveur ou extension. Les packages UI sont détaillés dans [02-design.md](02-design.md).

Les décisions structurantes et leur justification sont enregistrées dans [adr/README.md](adr/README.md).
La matrice datée des APIs, versions, licences et modes de distribution est tenue dans [12-api-fournisseurs-et-stack.md](12-api-fournisseurs-et-stack.md). La matrice des bases téléchargeables est tenue dans [13-jeux-de-donnees-et-imports.md](13-jeux-de-donnees-et-imports.md).
