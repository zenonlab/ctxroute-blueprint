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

Le snapshot R2 v1 existe mais il est vide en production et l'extension ne
compose aucun chargeur HTTP. Une lecture Agenda ne peut donc pas produire une
sortie après installation ou perte d'IndexedDB. FavLib démontre le besoin d'un
calendrier public commun, mais ses détails doivent respecter les autorités
TobiRink : favoris et progression restent privés, `storage.sync` ne contient
que les identifiants fournisseurs, et le Worker est l'unique détenteur de D1.

## Décision

Le Worker collecte une fois par jour deux lanes indépendantes : AniList pour
les sorties anime officielles et MangaUpdates pour les sorties manga,
manhwa et manhua confirmées. Kitsu reste un repli de résolution et ne produit
aucune date Agenda. MangaDex conserve son rôle d'identité exacte et de sorties
quand une responsabilité explicite est applicable, sans devenir l'autorité
du calendrier.

D1 reçoit uniquement des événements publics bornés : fournisseur, identifiant
public de l'œuvre, type de sortie, occurrence `DATE` ou `INSTANT`, état,
provenance, versions et expiration. Les écritures sont préparées, batchées,
idempotentes et conservées lors d'une panne. Un `403`, `429`, timeout ou
réponse incomplète est enregistré comme échec de lane, sans `NO_MATCH` et sans
faire échouer le cron global ; les dernières lignes valides restent servies.
Les titres, URLs, favoris,
progressions, dossiers, owners, installations, secrets et payloads fournisseurs
restent exclus.

`GET /v2/releases` est une lecture commune, paginée par fenêtre UTC, date et
clé sémantique stable. Elle ne reçoit aucun identifiant personnel et renvoie
un ETag. `/v1/releases` reste intact pendant la transition pour compatibilité
et rollback.

L'extension charge toutes les pages d'une même génération au plus une fois par
24 heures, les valide puis les écrit atomiquement dans IndexedDB. Une erreur
conserve la dernière génération valide. L'Agenda local joint ces événements
aux Works résolus par `(provider, providerWorkId)` uniquement. Il ne cherche
jamais un fournisseur pendant une lecture locale et ne joint jamais par titre.

Les dates civiles ne sont pas converties en minuit UTC. Une date officielle
remplace une estimation. Une estimation manga demande trois intervalles
positifs valides parmi douze observations maximum, filtre les intervalles à
`0,5×–2×` la médiane sur huit intervalles maximum et ne produit que la
prochaine date. Elle ne déclenche jamais de notification native.

## Conséquences

Le calendrier est mutualisable et cacheable sans transformer D1 en catalogue
privé. Le site et WebBridge ne voient toujours qu'une projection locale. Les
résultats publics restent disponibles hors ligne et les pannes fournisseur ne
réinitialisent pas le calendrier déjà validé. Une migration D1 de production,
un cron ou une publication R2 restent derrière la gate opérationnelle.
