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
  - docs/architecture/src/discovery-recovery.dataflow.json
review: on-change
revised: true
---

# ADR-0047 — Composant portable de découverte publique

- Status: accepted
- Date: 2026-09-14
- Revised: 2026-09-27

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
maximum, quatre pages par tranche, vingt candidats par enveloppe et vingt-cinq
candidats comparables conservés par fournisseur. Les candidats sans preuve
de similarité ne remplissent pas ce dernier budget; chaque nouvelle page est
inspectée avant conservation, pour ne pas masquer une identité exacte après
les vingt-cinq premiers résultats bruts. Une preuve exacte permet toujours
une sortie anticipée. Le matching approximatif et `NOT_FOUND` exigent des
enveloppes complètes, non tronquées et sans curseur restant.

Le budget de recherche est partagé par les fournisseurs, alias et fallbacks
d'une résolution. Après quatre pages avec un curseur valide restant, le
résolveur persiste un checkpoint v1 borné : fournisseur, page suivante, index
d'alias et candidats comparables déjà inspectés. Le claim suivant reprend
exactement cette page, rembourse l'essai temporaire et conserve le même
digest; il ne rejoue ni les pages déjà parcourues ni le POST d'admission. Le
checkpoint est supprimé lors de toute publication terminale et de toute
nouvelle admission explicite. Un curseur absent ou répété, une réponse
incomplète sans page suivante, une réponse invalide ou une borne de candidats
produit toujours `incomplete-provider-search`, jamais un cache négatif. Ces
erreurs restent consommantes : seul le checkpoint de pagination saine est un
report durable. Après huit échecs réels, le contrat D1 expose toujours
`UNAVAILABLE/ATTEMPT_LIMIT`, récupérable explicitement. Une véritable cadence
ou réponse `429`, sans autre échec consommant retenu, conserve son échéance et
son report sans consommation d'essai. Le timeout HTTP reste indépendant et
l'appel déjà en vol n'est pas annulé par le budget du résolveur; aucune
nouvelle page n'est démarrée après son expiration.

Dans les recherches sans référence exacte des lanes `MANGA`, `MANHWA` et
`MANHUA`, l'ordre est `MangaDex`, `Kitsu Manga`, puis `MangaUpdates`. Les deux
premiers fournisseurs peuvent donc apporter une preuve exacte avant la
recherche paginée MangaUpdates, dont la cadence de six secondes peut à elle
seule consommer presque tout le budget partagé. Le fallback après l'hydratation
transitoirement indisponible d'une identité recherchée continue avec les
fournisseurs restants dans ce même ordre. Une référence exacte explicite reste
limitée à son fournisseur. Ce routage ne change ni les règles de matching, ni
la priorité des preuves, ni le comportement fermé d'une réponse incomplète :
faute de preuve exacte chez les fournisseurs rapides, MangaUpdates reste
interrogé et ses bornes restent applicables.

La compatibilité des médias est une fonction pure partagée entre le matcher
portable, le matcher local et les indices synchronisés : `MANGA`, `MANHWA` et
`MANHUA` appartiennent à la même famille de recherche, jamais à la lane anime.
La classification hydratée reste précise. Cette fonction ne change ni les
empreintes, ni les versions de parseur/adaptateur, ni les clés publiques v3.
Un indice synchronisé doit respecter le schéma fermé, la corrélation, la
famille du média et les fournisseurs compatibles déjà définis par le sélecteur
existant. La préparation publique conserve sa limite d'une seule référence ;
une référence explicite de la source reste prioritaire et ne lit pas cet indice.

Le matcher portable consomme les marqueurs de format et de saison déjà
présents dans la requête v3. OVA et pré-sérialisation restent symétriques ;
une saison explicite doit être corroborée par la métadonnée du candidat ou
une saison unique extraite de ses titres. Le suffixe saisonnier
corroboré peut être retiré des deux titres comparés, sans retirer leurs nombres
intrinsèques. Les numéros différents interdisent aussi une correspondance
approximative. Avant publication d'une identité découverte par titre, son
hydratation respecte les mêmes contraintes et la même lane prouvée. Lorsque
le fournisseur et l'identifiant sont strictement identiques, l'absence de
format ou de preuve de saison dans l'hydratation conserve seulement la preuve
de recherche correspondante pour ce contrôle. Une métadonnée présente ou une
saison portée par les titres hydratés ne peut pas être remplacée par cette
preuve ; les champs et titres du profil publié restent ceux de l'hydratation,
sans enrichissement artificiel ni union d'aliases. Une dérive
de média, format, pré-sérialisation ou saison constitue une erreur d'invariant,
jamais un `VERIFIED` ou un faux `NOT_FOUND`, y compris après fallback. Ce
contrôle ne modifie pas l'hydratation directe d'une référence explicite,
prioritaire sur les indices de titre. Les gardes des recherches incomplètes
et des deux lanes `UNKNOWN` restent inchangées. Aucun ancien résultat D1 n'est
réarmé, migré ou invalidé automatiquement par ce refactoring.

Une projection de recherche ne transforme pas un champ fournisseur optionnel
non fiable en perte de l'identité entière. Pour Kitsu, une couverture dont
l'origine ne respecte pas l'allowlist est omise sans élargir cette allowlist.
Le helper partagé accepte les couvertures des cinq providers uniquement sur
leur origine HTTPS exacte, sans identifiants ni port non standard ; les schémas
`blob:`, `javascript:` et HTTP restent refusés même si leur hostname paraît
autorisé.
Une ressource du mauvais type ou dont l'identité ne peut pas être encodée est
écartée. Toute omission marque l'enveloppe incomplète : les candidats valides
restent utilisables, mais l'absence de correspondance ne peut jamais produire
un faux `NOT_FOUND`. Sans correspondance exacte, cette incomplétude devient le
code fermé `provider-search-cursor` et consomme l'essai courant ; elle ne se
confond pas avec un report de cadence ou `429`. La validation et cette
projection s'exécutent sous la même gate de cadence afin qu'un rejet résiduel
alimente correctement l'état runtime du fournisseur.

Les erreurs ordinaires de transport, HTTP hors `429` et validation remontent
sans conversion en `FavoriteProviderRetryError`. Le résolveur garde la cause
prioritaire : recherche incomplète, erreur ordinaire, puis report typé avec
l'échéance maximale. Une erreur ordinaire ne peut donc disparaître derrière
une cadence ultérieure dans une recherche, une lane `UNKNOWN` ou un fallback
d'hydratation. Un fallback réussi conserve son résultat. Le collecteur
existant compte l'erreur non remboursable sans modifier les tables, les
contrats publics ou les profils déjà vérifiés.

Le checkpoint est une reprise inter-baux uniquement pour une pagination saine
et validée. Il est stocké dans une colonne D1 distincte des payloads et
résultats publics, borné par le schéma portable et effacé dès qu'une demande
termine. Il ne remplace pas les garde-fous d'erreur : les limites structurelles
et les réponses inconsistantes continuent à épuiser les essais au lieu de
créer une boucle sans borne.

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
