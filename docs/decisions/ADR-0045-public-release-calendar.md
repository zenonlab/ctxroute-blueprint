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
JWKS GitHub, issuer, audience, dépôt, branche et identité exacte du workflow,
valide nonce, digest, fenêtre et schéma, puis reste l'unique auteur D1.

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

L'extension possède un repli direct. Quand le calendrier D1 est absent, périmé
ou incomplet, elle collecte les mêmes fenêtres publiques page par page depuis
MV3, avec checkpoint IndexedDB et cadence durable. Ce repli n'envoie aucun
favori, titre, URL ou ensemble d'identifiants au Worker et ne contribue rien à
D1. Une génération publique récente remplace ensuite le repli local.

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

`GET /v2/releases` est une lecture commune, paginée par occurrence puis clé
sémantique stable. Son curseur porte ces deux valeurs et sa révision dérive de
la génération validée, jamais du nombre de lignes d'une page. Elle ne reçoit
aucun identifiant personnel et renvoie un ETag exact pour sa fenêtre.
`/v1/releases` reste intact pendant la transition pour compatibilité et
rollback.

L'extension charge toutes les pages d'une même génération au plus une fois par
24 heures, les valide puis les écrit atomiquement dans IndexedDB. Le cache
Agenda ne réside pas dans `storage.local`. Une erreur conserve la dernière
génération valide. L'Agenda local joint ces événements aux Works résolus par
`(provider, providerWorkId)` uniquement. Il ne cherche jamais un fournisseur
pendant une lecture locale et ne joint jamais par titre.

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
fournisseur ne réinitialisent pas le calendrier validé. Le repli direct augmente
le trafic fournisseur seulement lorsque le cache partagé ne peut pas servir une
génération complète. La publication du Worker et du workflow reste derrière
les gates opérationnelles correspondantes. Aucun secret d'ingestion ou `.env`
Agenda n'est créé.
