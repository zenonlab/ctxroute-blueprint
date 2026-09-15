---
scope:
  - apps/worker/src/releases/**
  - apps/worker/src/index.ts
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/native-collectors.test.ts
  - apps/worker/migrations/**
  - apps/worker/wrangler.jsonc
  - packages/application/src/agenda/**
  - packages/adapters-browser/src/releases/**
  - packages/adapters-indexeddb/src/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/agenda/**
  - packages/public-discovery/**
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

La collecte partagée s’exécute dans le consumer Queue du Worker. Un cron toutes
les dix minutes dépose uniquement un signal `agenda-refresh`; le consumer lit
deux lanes indépendantes, AniList pour les sorties anime officielles et
MangaUpdates pour les sorties manga, manhwa et manhua confirmées. Il promeut
directement une génération complète, bornée, versionnée et sans donnée
personnelle dans D1. Aucun runtime GitHub ni route d’ingestion externe n’est
nécessaire; l’ancienne route `POST /v2/releases/generations` répond 410.

La collecte déclenchée par `GET /v2/releases` reste supprimée : une lecture
publique ne provoque jamais une requête fournisseur. Le candidat local ajoute
un cron Worker toutes les dix minutes qui dépose un signal sans événement dans la même
Cloudflare Queue que Discovery. Le consumer collecte les deux lanes, refuse
tout lot incomplet et promeut directement la génération D1. Tout `403`, `429`,
timeout ou échec conserve la dernière génération valide et reprogramme le
message selon une temporisation bornée.

AniList et MangaUpdates sont joints uniquement via la gateway sortante signée de
l’ADR-0051; l’adresse de sortie n’appartient donc pas à Cloudflare. La signature,
l’horodatage, l’anti-rejeu, l’allowlist et les limites de corps s’appliquent aussi
à Agenda. La Queue, la gateway Deno, Deno KV et les secrets passent par leurs
gates opérationnelles. La certification du 15 septembre 2026 a produit une
génération active de 711 événements, dont 225 AniList et 486 MangaUpdates.

L'extension ne possède aucun repli fournisseur Agenda. Elle lit le calendrier
D1 par `/v3/releases`; une indisponibilité réseau peut réutiliser la dernière
génération partagée de même fenêtre tant qu'elle a moins de huit jours. Sans
génération partagée valide, Agenda expose son état indisponible et attend la
prochaine collecte planifiée. Ni un démarrage, ni une alarme, ni une lecture Agenda
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
l’egress Cloudflare vers les fournisseurs. Une collecte hebdomadaire alimente toutes les lectures;
une recherche utilisateur ne relance pas les fournisseurs Agenda. Le site et WebBridge ne voient toujours qu'une projection
locale. Les résultats publics restent disponibles hors ligne et les pannes
fournisseur ne réinitialisent pas le calendrier validé. Après bascule certifiée,
seul le consumer Worker via proxy appellera les fournisseurs Agenda. La Queue,
le proxy, leurs secrets et le Worker restent derrière leurs gates
opérationnelles; cette décision locale ne crée aucun secret ni ressource.
