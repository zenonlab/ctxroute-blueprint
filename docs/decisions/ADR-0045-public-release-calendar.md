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
  - docs/architecture/src/agenda-release.dataflow.json
review: on-change
revised: true
---

# ADR-0045 — Calendrier public de sorties et projection Agenda locale

## Contexte

Le snapshot R2 v1 et la route D1 v2 existent, mais D1 reste vide en production.
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

La collecte partagée est séparée du Worker HTTP. Un collecteur planifié dont
l'egress AniList a été vérifié lit deux lanes indépendantes : AniList pour les
sorties anime officielles et MangaUpdates pour les sorties manga, manhwa et
manhua confirmées. Il transmet au Worker des lots signés, bornés, versionnés et
sans donnée personnelle. Le Worker valide nonce, digest, fenêtre et schéma,
puis reste l'unique auteur D1. Le fournisseur d'exécution du collecteur n'est
pas choisi avant un smoke test répété de son egress et une approbation
opérationnelle distincte.

L'extension possède un repli direct. Quand le calendrier D1 est absent, périmé
ou incomplet, elle collecte les mêmes fenêtres publiques page par page depuis
MV3, avec checkpoint IndexedDB et cadence durable. Ce repli n'envoie aucun
favori, titre, URL ou ensemble d'identifiants au Worker et ne contribue rien à
D1. Une génération publique récente remplace ensuite le repli local.

Kitsu reste un repli de résolution et ne produit aucune date Agenda. MangaDex
conserve son rôle d'identité exacte et de sorties spécialisées sans devenir
l'autorité générale du calendrier.

D1 reçoit uniquement des événements publics bornés : fournisseur canonique en
minuscules, identifiant public de l'œuvre, type et numéro textuel de sortie,
occurrence `DATE` ou `INSTANT`, état, provenance, versions et expiration. Une
migration additive conserve les tables v1. Les écritures sont préparées,
batchées et idempotentes. Un `403`, `429`, timeout ou résultat incomplet est un
échec technique et conserve la dernière génération valide. Les titres, URLs,
favoris, progressions, dossiers, owners, installations, secrets et payloads
fournisseurs restent exclus.

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
l'egress Cloudflare. Le site et WebBridge ne voient toujours qu'une projection
locale. Les résultats publics restent disponibles hors ligne et les pannes
fournisseur ne réinitialisent pas le calendrier validé. Le repli direct augmente
le trafic fournisseur seulement lorsque le cache partagé ne peut pas servir une
génération complète. Une migration D1 de production, un nouveau collecteur, un
secret d'ingestion, un cron ou une publication restent derrière la gate
opérationnelle.
