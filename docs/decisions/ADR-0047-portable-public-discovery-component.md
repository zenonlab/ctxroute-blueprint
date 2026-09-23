---
scope:
  - packages/public-discovery/**
  - packages/application/src/public-discovery/**
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-cloudflare/src/catalogue/**
  - apps/worker/src/catalogue/**
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/native-collectors.test.ts
  - apps/worker/migrations/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/wxt.config.ts
  - docs/architecture/src/public-discovery.dataflow.json
review: on-change
revised: true
---

# ADR-0047 — Composant portable de découverte publique

- Status: accepted
- Date: 2026-09-14
- Revised: 2026-09-23

## Contexte

Le script de vérification importe directement l’application et les adaptateurs
TobiRink, lit `process.env` et connaît les routes de production. Il ne peut pas
être extrait dans un autre dépôt sans copier le monorepo et sa composition.
L’extension possède en parallèle les mêmes adaptateurs fournisseurs, ce qui
duplique l’autorité réseau et les permissions.

## Décision

Créer `@tobirink/public-discovery` comme composant TypeScript autonome. Son
manifeste ne dépend d’aucun package `@tobirink/*`; son API publique reçoit des
ports injectés pour lire un lot de demandes, résoudre une demande, publier les
résultats et fournir l’horloge, le nonce et les limites. Le composant ne lit ni
variable d’environnement, ni secret, ni API GitHub, ni binding Cloudflare.

Le contrat ferme les fournisseurs à `anilist`, `mangaupdates`, `mangadex`,
`kitsu-anime` et `kitsu-manga`. Un résolveur injecté possède la recherche, le
matching et l’hydratation. Le moteur portable orchestre les lots, isole un échec
transitoire par demande, refuse les résultats dont la clé ou le digest diffère,
et publie seulement des objets JSON validés. Il ne transporte jamais `Request`,
`Response`, `Error`, fonction ou instance de classe à travers ses ports.

Le package porte le matching borné et les adaptateurs AniList, MangaUpdates,
MangaDex, Kitsu Anime et Kitsu Manga. Leur composition appartient au consumer
Worker natif; les anciens clients HTTP/OIDC et CLI de collecte sont retirés.

Le résolveur suit les curseurs de recherche réels : quatre alias distincts au
maximum, quatre pages par alias, vingt candidats par enveloppe et vingt-cinq
candidats comparables conservés par fournisseur. Les candidats sans preuve
de similarité ne remplissent pas ce dernier budget; chaque nouvelle page est
inspectée avant conservation, pour ne pas masquer une identité exacte après
les vingt-cinq premiers résultats bruts. Une preuve exacte permet toujours
une sortie anticipée. Le matching approximatif et `NOT_FOUND` exigent des
enveloppes complètes, non tronquées et sans curseur restant.

Le budget de recherche de vingt secondes est partagé par les fournisseurs,
alias et fallbacks d'une résolution. Un curseur absent ou répété, une réponse
incomplète ou une borne atteinte produit `incomplete-provider-search`, jamais
un cache négatif. Cette erreur consomme un essai du bail existant; elle ne
devient pas un report de cadence sans essai. Après huit échecs, le contrat D1
expose toujours `UNAVAILABLE/ATTEMPT_LIMIT`, récupérable explicitement. Une
véritable cadence ou réponse `429` conserve son échéance et son report sans
consommation d'essai. Le timeout HTTP reste indépendant et l'appel déjà en
vol n'est pas annulé par le budget du résolveur; aucune nouvelle page n'est
démarrée après son expiration.

Les curseurs restent locaux à une exécution : aucun checkpoint de pagination
n'est ajouté à D1 dans ce correctif. Le gate attend déjà les créneaux de huit
secondes ou moins, ce qui permet la page suivante sans refaire la page une
en cadence normale. Un vrai report sous contention peut néanmoins recommencer
la recherche au réveil. Une reprise durable inter-baux demanderait une
évolution séparée du contrat et des mesures de contention; elle n'est pas
déclarée acquise. Les limites structurelles, elles, épuisent les essais au
lieu de recommencer indéfiniment sans les compter.

Le package expose un export public stable, un test avec ports mémoire et un
contrôle d’isolation qui échoue sur tout import `@tobirink/*` ou identifiant
ressemblant à un secret. Cette autonomie préserve une frontière testable sans
exiger un dépôt d’exécution distinct.

Le runtime cible remplace le sondage GitHub par un signal Cloudflare Queue
émis immédiatement après la matérialisation `PENDING`. Ce signal ne contient
que son type et sa version : les titres et la clé restent dans D1. Le consumer
Worker réclame ensuite le lot directement dans D1, applique le bail et les
digests existants, puis acquitte ou reprogramme explicitement le message. La
livraison au moins une fois reste sûre grâce à l’idempotence D1.
Huit retries Queue donnent une neuvième livraison : elle constate le huitième
bail expiré, matérialise `FAILED/ATTEMPT_LIMIT`, ne réclame aucun nouveau lot et
acquitte le signal au lieu de le laisser en DLQ.

Les appels fournisseurs du consumer traversent `ProviderTransportPort`. Le
consumer et les adaptateurs AniList, MangaUpdates, MangaDex et Kitsu ne
connaissent ni l’hébergeur ni le mode de sortie. La composition Worker possède
une gate fermée à deux adaptateurs : `direct`, sélectionné par défaut sans
secret, et `gateway`, sélectionné explicitement avec une origine HTTPS exacte
et une clé HMAC de 32 à 256 octets. Les deux chemins refusent toute cible ou
méthode hors de l’allowlist fournisseur et les redirections.

Le mode `gateway` conserve une enveloppe versionnée, bornée à 64 Kio,
horodatée et signée HMAC-SHA-256. Le serveur proxy embarqué, son registre de
nonces mémoire et son test quittent le composant portable. Toute passerelle
externe doit vérifier la signature, l’horodatage, l’anti-rejeu et les mêmes
bornes avant certification; aucune implémentation de serveur n’est activée par
cette décision. Le détail et les candidats gratuits sont fixés par l’ADR-0051.

Cette racine est publiée sous licence MIT et reste `private: true` au sens npm :
le code peut être public sans autoriser une publication accidentelle sur le
registre. `zod` reste l’unique dépendance d’exécution; TypeScript, Vitest,
et les types Node sont des dépendances de développement épinglées. Le lockfile
autonome doit être résolu depuis ce manifeste par la version npm exécutée sur
le runner public et réussir `npm ci` hors du monorepo.

## Conséquences

La cadence et l’hébergeur du collecteur peuvent changer sans modifier
l’extension. Le transport fournisseur peut changer sans modifier le consumer :
seule la composition externe du Worker sélectionne son adaptateur. La Queue et
la gateway ont été certifiées en trafic réel; les anciennes routes externes de
claim et publication répondent désormais 410.

Le contrat actif est la version `3`, alignée sur les routes HTTP publiques v3,
avec des lots de cinquante demandes au maximum, deux listes de quatre titres au
maximum et les issues terminales `VERIFIED`, `NOT_FOUND` et `AMBIGUOUS`. Le
passage depuis l’ancien numéro interne `2` renomme les symboles et tables
actifs sans modifier les clés ni perdre les demandes déjà matérialisées.

La Queue supprime l’attente de cadence : un cache miss programme le traitement
dès la création `PENDING`. Le test réel confirme qu’AniList répond 403 depuis
l’egress Cloudflare direct mais réussit via la gateway Deno signée. Les appels
directs conservés pour MangaDex et Kitsu portent le `User-Agent` produit stable
exigé par les amonts; cette règle ne transmet aucune donnée privée. Le dépôt
principal conserve toute l’implémentation; le dépôt public n’est plus un
rollback opérationnel.
