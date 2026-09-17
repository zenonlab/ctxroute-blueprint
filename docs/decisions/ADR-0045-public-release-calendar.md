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
  - packages/adapters-cloudflare/src/releases/**
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

La projection Agenda historique conserve des pages fournisseur, des snapshots
fusionnés et une ligne SQL par occurrence. Son coût dépend du déplacement de la
fenêtre même lorsque la règle de sortie n'a pas changé. Le produit possède déjà
un prédicteur manga borné et les fournisseurs livrent soit des dates annoncées,
soit des observations passées. Les événements futurs peuvent donc être dérivés
sans devenir des enregistrements distants durables.

## Décision

La collecte partagée s’exécute dans le consumer Queue du Worker. Le cron
`23 3 * * SUN` dépose un signal le dimanche à 03:23 UTC. Les demandes,
checkpoints, baux, pages de session et douze observations maximum par œuvre
résident dans R2 sous des objets bornés, écrits conditionnellement avec un jeton
de propriété. Un signal Queue ne constitue jamais la preuve que le travail est
durable : l'objet est écrit avant l'envoi et un envoi échoué reste récupérable.

La collecte déclenchée par `GET /v2/releases` reste supprimée : une lecture
publique ne provoque jamais une requête fournisseur. Le cron hebdomadaire
dépose un signal sans événement dans la même Cloudflare Queue que Discovery.
Chaque lane acquiert son propre objet R2 avec jeton de propriété, écrit chaque
page validée conditionnellement, puis avance `next_page` et `not_before`. Une nouvelle
livraison reprend après la dernière page enregistrée. Tout `403`, `429`, timeout
ou échec conserve le dernier snapshot valide de la lane; `Retry-After` prime
sur le backoff Queue dans la limite de vingt-quatre heures.

Une collecte terminée produit un modèle compact par œuvre : date et numéro
d'ancrage, intervalle prédit éventuel, prochaine date annoncée, exceptions
connues, bornes de validité, source et version de normalisation. D1 ne reçoit ce
modèle courant que si son digest sémantique change. La version précédente reste
lisible tant que tous les objets de la nouvelle version ne sont pas vérifiés et
que son pointeur n'est pas publié. La rétention garde la version active et deux
versions précédentes; aucun objet référencé ne peut expirer.

AniList et MangaUpdates sont joints uniquement via la gateway sortante signée de
l’ADR-0051; l’adresse de sortie n’appartient donc pas à Cloudflare. La signature,
l’horodatage, l’anti-rejeu, l’allowlist et les limites de corps s’appliquent aussi
à Agenda. La Queue, la gateway Deno, Deno KV et les secrets passent par leurs
gates opérationnelles. La certification du 15 septembre 2026 a produit une
génération active de 711 événements, dont 225 AniList et 486 MangaUpdates.

L'extension ne possède aucun repli fournisseur Agenda. Elle lit les modèles
projetés par `/v3/releases`; une indisponibilité réseau peut réutiliser la dernière
génération partagée de même fenêtre tant qu'elle a moins de huit jours. Sans
génération partagée valide, Agenda expose son état indisponible et attend la
prochaine collecte planifiée. Ni un démarrage, ni une alarme, ni une lecture Agenda
ne peut appeler AniList ou MangaUpdates depuis MV3.

Kitsu reste un repli de résolution et ne produit aucune date Agenda. MangaDex
conserve son rôle d'identité exacte et de sorties spécialisées sans devenir
l'autorité générale du calendrier.

D1 conserve seulement le modèle public courant attaché à l'œuvre canonique.
Un `403`, `429`, timeout ou résultat incomplet conserve le dernier modèle
valide. Les titres privés, URLs de favoris, progressions, dossiers, owners,
installations, secrets et payloads fournisseurs restent exclus.

AniList suit `pageInfo.hasNextPage`, au plus 50 éléments par page, une seule
collecte concurrente et une cadence minimale de 3 secondes, soit vingt requêtes
HTTP par minute au maximum. MangaUpdates utilise `page`, `per_page` et
`total_hits` retournés, avec une seule collecte concurrente et une cadence
minimale de 6 secondes, soit dix requêtes HTTP par minute au maximum. Son
`release_date` devient `DATE/CONFIRMED`; `time_added` reste une date
d'observation et ne devient jamais un horaire de sortie. Les valeurs comme
`58.5`, `2a` et `29-29.5 (end)` restent des numéros textuels bornés.

`GET /v3/releases` reste compatible avec les extensions publiées, mais génère
sa page à la volée depuis les modèles, avec les mêmes limites de fenêtre,
pagination, curseur et ETag. Les anciennes versions restent servies pendant la
transition. Aucune lecture ni projection ne modifie D1 ou R2.

L'extension valide et conserve les modèles de ses œuvres dans IndexedDB, puis
projette localement les occurrences utiles. Elle joint par identité fournisseur
exacte, jamais par titre, et ne contacte aucun fournisseur lors d'une lecture.
La progression privée et les compteurs confirmés ne sont jamais avancés par une
date prévue.

Les dates civiles ne sont pas converties en minuit UTC. Une date AniList
explicite prime et ne peut être compressée que si règle et exceptions la
reproduisent exactement. Sans date future, le prédicteur existant exige trois
intervalles positifs parmi douze observations maximum, examine huit intervalles
maximum et filtre autour de `0,5×–2×` la médiane avant moyenne. Il ne produit
que la prochaine occurrence. Les œuvres terminées, annulées ou en hiatus ne
sont pas prédites; un chapitre textuel ou fractionnaire reste textuel.

## Conséquences

Le passage du temps ne déclenche plus d'écriture distante. Les observations et
états de reprise sortent de D1; les métadonnées publiques actuelles y restent
requêtables. Le collecteur reste hebdomadaire, mutualisé et limité par les
cadences existantes. Les métriques rapportent séparément D1, R2, Queue,
fournisseurs et Worker, sans titre, identifiant d'œuvre ou payload.
