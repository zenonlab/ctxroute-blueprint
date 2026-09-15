---
scope:
  - apps/worker/src/releases/**
  - apps/worker/src/index.ts
  - apps/worker/migrations/**
  - apps/worker/wrangler.jsonc
  - packages/application/src/agenda/**
  - packages/adapters-browser/src/releases/**
  - packages/adapters-indexeddb/src/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/agenda/**
  - packages/public-discovery/**
  - .github/workflows/agenda-collector.yml
  - docs/architecture/src/agenda-release.dataflow.json
review: on-change
revised: true
---

# ADR-0045 — Calendrier public de sorties et projection Agenda locale

## Contexte

Le snapshot R2 v1 et la route D1 v2 existent, mais les dernières lectures
publiques observées ne montrent aucune génération Agenda active (`d1-empty`).
Cela ne constitue pas un comptage de toute la base D1, notamment du cache
`favorite_public_cache`, distinct du catalogue exposé par `/v1/catalogue`.
Le 13 septembre 2026, AniList a répondu normalement depuis la machine et
l'extension, tandis que le cron Cloudflare a reçu HTTP 403 avec le message
`You have been manually blocked`. Espacer davantage le cron ne change pas
l'egress bloqué.

Le code livré tronque aussi AniList à sa première page, laisse MangaUpdates
vide et élimine les occurrences civiles dans la projection. Une réponse live
MangaUpdates a renvoyé `per_page: 40` malgré une taille demandée différente;
la pagination doit suivre l'enveloppe reçue. FavLib démontre les invariants
utiles, mais sa formule de terminaison MangaUpdates ne constitue pas un oracle.

## Décision

La collecte partagée est séparée du Worker HTTP. Le package MIT autonome du
dépôt public `tristan-monticelli/tobirink-public-discovery` possède les contrats,
parseurs et collecteurs Agenda sans dépendance au monorepo privé. Son workflow
GitHub Actions `agenda.yml`, planifié chaque lundi à 03:17 UTC, lit deux lanes indépendantes : AniList pour les
sorties anime officielles et MangaUpdates pour les sorties manga, manhwa et
manhua confirmées. Il transmet au Worker une génération complète, bornée,
versionnée et sans donnée personnelle. Un jeton GitHub OIDC court authentifie
l'émetteur sans secret partagé sur l’audience `workers.dev`. Le Worker vérifie signature RS256 auprès du
JWKS GitHub, issuer, audience, dépôt, IDs immuables du dépôt et du propriétaire,
branche et identité exacte du workflow,
valide nonce, digest, fenêtre et schéma, puis reste l'unique auteur D1.

L’identité publique attend `repository_id=1370309060` et
`repository_owner_id=239743354`, vérifiés depuis l’API GitHub. Une lecture JWKS
est interrompue après trois secondes et reste limitée à 64 Kio et seize clés.
Les clés validées sont mises en cache au plus cinq minutes dans une structure
bornée par fetcher; un `kid` absent force immédiatement un rafraîchissement afin
de permettre la rotation sans élargir la confiance.

Le workflow du dépôt privé est manuel et vérifie seulement l’export autonome.
Il ne demande aucun jeton OIDC, n’appelle aucun fournisseur et ne publie aucune
génération. La source publique devient ainsi l’unique exécuteur partagé des
requêtes AniList et MangaUpdates.

Le cron Cloudflare et la collecte déclenchée par `GET /v2/releases` sont
supprimés : une lecture publique ne provoque jamais une requête fournisseur.
Le workflow respecte les cadences et traite tout `403`, `429`, timeout ou lot
incomplet comme un échec total. Son activation et la première collecte réelle
restent des opérations publiées et vérifiées séparément; aucun succès n'est
déduit des fixtures locales.

L'extension ne possède aucun repli fournisseur Agenda. Elle lit le calendrier
D1 par `/v3/releases`; une indisponibilité réseau peut réutiliser la dernière
génération partagée de même fenêtre tant qu'elle a moins de huit jours. Sans
génération partagée valide, Agenda expose son état indisponible et attend la
prochaine collecte GitHub. Ni un démarrage, ni une alarme, ni une lecture Agenda
ne peut appeler AniList ou MangaUpdates depuis MV3.

Kitsu reste un repli de résolution et ne produit aucune date Agenda. MangaDex
conserve son rôle d'identité exacte et de sorties spécialisées sans devenir
l'autorité générale du calendrier.

D1 Agenda reçoit uniquement les événements publics bornés : fournisseur
canonique en minuscules, identifiant public de l'œuvre, type et numéro textuel de sortie,
occurrence `DATE` ou `INSTANT`, état, provenance, versions et expiration. Une
migration additive conserve les tables v1. Les écritures sont préparées,
batchées et idempotentes. Un `403`, `429`, timeout ou résultat incomplet est un
échec technique et conserve la dernière génération valide. Les titres, URLs
de favoris, favoris, progressions, dossiers, owners,
installations, secrets et payloads fournisseurs restent exclus.

AniList suit `pageInfo.hasNextPage`, au plus 50 éléments par page et une cadence
minimale de 2,2 secondes. MangaUpdates utilise `page`, `per_page` et
`total_hits` retournés, avec une cadence minimale de 3 secondes. Son
`release_date` devient `DATE/CONFIRMED`; `time_added` reste une date
d'observation et ne devient jamais un horaire de sortie. Les valeurs comme
`58.5`, `2a` et `29-29.5 (end)` restent des numéros textuels bornés.

`GET /v2/releases` reste byte-compatible avec les extensions déjà publiées.
`GET /v3/releases` ajoute la fenêtre source de la génération active. Les deux
lectures sont paginées par occurrence puis clé sémantique stable, refusent une
plage supérieure à quarante jours et ne reçoivent aucun identifiant personnel.
Le curseur porte occurrence et identifiant; la révision dérive de la génération
validée et l'ETag exact inclut version de route, révision et fenêtre demandée.
`/v1/releases` reste intact pour compatibilité et rollback.

L'extension charge toutes les pages d'une même génération au plus une fois par
24 heures, les valide puis les écrit atomiquement dans IndexedDB. Une réponse
partagée est utilisable seulement si elle a moins de huit jours et si sa fenêtre
source couvre intégralement la fenêtre demandée. Une réponse plus ancienne,
hors couverture ou contenant une ligne invalide échoue fermée sans appeler de
fournisseur. Le cache Agenda ne réside pas dans `storage.local`. Une erreur
réseau conserve et peut servir la dernière génération partagée valide de même
fenêtre. L'Agenda local joint ces événements aux Works résolus par
`(provider, providerWorkId)` uniquement. Il ne cherche jamais un fournisseur
pendant une lecture locale et ne joint jamais par titre.

Après une promotion complète, la transaction de cycle de vie conserve la
génération active et au plus les deux générations précédentes. Elle supprime
d'abord leurs événements enfants puis les générations parentes; le pointeur
actif est exclu explicitement de chaque requête de rétention. Une ingestion
interrompue ne change pas le pointeur, et son staging éventuel sera borné par la
prochaine promotion réussie.

La collecte MangaUpdates compte les lignes reçues, acceptées et sans identité
de série sans journaliser titre ni payload. Une lane dont plus de cinq pour cent
des lignes reçues sont sans identité échoue entièrement afin qu'une dérive de
schéma fournisseur ne réduise pas silencieusement le calendrier partagé.

Les dates civiles ne sont pas converties en minuit UTC. Une date confirmée
remplace une estimation. Une estimation manga demande trois intervalles
positifs valides parmi douze observations maximum, filtre les intervalles à
`0,5×–2×` la médiane sur huit intervalles maximum et ne produit que la
prochaine date. Elle ne déclenche jamais de notification native et aucune heure
n'est inventée pour MangaUpdates.

## Conséquences

Le calendrier reste mutualisable sans rendre l'utilisateur dépendant de
l'egress Cloudflare. Une collecte hebdomadaire alimente toutes les lectures;
une recherche utilisateur ne relance pas les fournisseurs Agenda. Le site et WebBridge ne voient toujours qu'une projection
locale. Les résultats publics restent disponibles hors ligne et les pannes
fournisseur ne réinitialisent pas le calendrier validé. Seul le workflow public
planifié ou déclenché manuellement appelle les fournisseurs Agenda. La publication du Worker et du workflow reste derrière
les gates opérationnelles correspondantes. Aucun secret d'ingestion ou `.env`
Agenda n'est créé.
