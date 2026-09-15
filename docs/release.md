# Extension packaging and rollback

## Build a release candidate

The current production archives remain immutable. The published production
archives are `1.0.30`; the repository source is the unpublished `1.0.31`
candidate.
`apps/extension/package.json` is the only
version source: WXT reads it for both manifests, the packager reads it for ZIP
names, and the download page derives its two public links from it.

Run `npm run package:extension` from the repository root. The command rebuilds
both browser targets and writes these ignored, reproducible artifacts:

- `apps/extension/.output/packages/tobirink-chrome-mv3-<version>.zip`
- `apps/extension/.output/packages/tobirink-firefox-mv3-<version>.zip`
- `apps/extension/.output/packages/release-manifest.json`

ZIP entries are sorted, compressed with a fixed level and carry a fixed DOS
timestamp. The packager creates each archive twice in memory and refuses a byte
difference. The manifest records target, version, file count, byte size and
SHA-256.
The release packager also injects and verifies the exact non-secret bridge
origin `https://tobirink.com/*` in both generated manifests.
Standard WXT builds use that production origin by default, so the unpacked
Chrome directory remains compatible with WebBridge after `npm run verify`.
Development against another exact HTTPS origin requires an explicit
`WXT_PUBLIC_SITE_ORIGIN` override.

Packaging is local only. It never signs, uploads, publishes, deploys, edits a
store listing or handles store credentials. Submission remains a separate
manual operation after the browser checks in `docs/browser-support.md` pass.

The production download paths are versioned and fixed to the Worker domain:
`https://tobirink.com/downloads/tobirink-chrome-mv3-<version>.zip` and
`https://tobirink.com/downloads/tobirink-firefox-mv3-<version>.zip`. The page
may reference these paths only after the matching ZIPs and SHA-256 manifest have
been accepted and uploaded through an explicitly approved provider operation.

### Published mutualisation correction — 1.0.26

Candidate `1.0.26` activates the already consented owner runtime for an
installation without a recorded choice before the inventory maintenance pass.
It therefore sends each hydrated official profile to the existing authenticated
Worker contribution path, while preserving an explicit revocation and excluding
private titles, URLs, folders and progress. These archives are published; the
new Agenda collector and the local 1.0.27 transport correction are not.

### Correction publiée — cache vérifié sans Collectif

La version 1.0.27 retire des paquets actifs la section Options, les messages
et les routes HTTP de consentement/appairage. La résolution utilise désormais
le cache D1 `MISS/PENDING/VERIFIED` : un bail unique autorise une seule recherche
textuelle concurrente, les autres clients attendent, puis une proposition d’IDs
reste non fiable jusqu’à sa promotion par le workflow GitHub OIDC. La migration
D1, les archives et le Worker corrigés ont été publiés le 14 septembre 2026.

### Découverte serveur portable 1.0.28 publiée et certifiée

La version `1.0.28` remplace, pour la découverte automatique, le bail de
recherche confié à l’extension par une demande D1 v2 dédupliquée. Le composant
portable `@tobirink/public-discovery`, appelé par GitHub Actions, possède seul
l’orchestration des lanes AniList, MangaUpdates, MangaDex, Kitsu Anime et Kitsu
Manga. Il publie une fiche complète ou une issue terminale via OIDC.

La migration `0012_server_public_discovery.sql` est appliquée sur D1 et le
Worker `tobirink-public-api` est publié sur la route existante ainsi que sur
`tobirink-public-api.choukky.workers.dev`; le durcissement final des journaux
OIDC correspond à la version Worker `5ed013e0-18f3-412a-ac4e-57273efa7d47`.
`packages/public-discovery` est une racine MIT autonome publiée dans le dépôt public
`tristan-monticelli/tobirink-public-discovery`. Elle contient les cinq
adaptateurs, le matching, le CLI, son lockfile et le workflow quotidien/manual.
Le workflow privé homonyme ne lance aucune collecte planifiée.

Le Worker n’accorde les audiences v3 qu’au dépôt public exact, à
`refs/heads/main`, à `.github/workflows/collect.yml` et aux événements
`schedule` ou `workflow_dispatch`. Aucun secret partagé ou fichier `.env`
n’est requis. Le run public `34879839965`, sur le commit public
`f208aca5a2a5d695680658493464d2852266802b`, a revendiqué une requête réelle,
interrogé les fournisseurs et publié une fiche complète : `claimed=1`,
`failed=0`, `published=1`, `replayed=0`.

D1 conserve la fiche Frieren dans l’état `VERIFIED`, avec 1778 octets de
résultat et l’horodatage `2026-09-14T18:17:19.741Z`. Le run immédiatement
suivant `34879931399` rapporte `claimed=0`, et une nouvelle soumission HTTP de
la même œuvre retourne directement la même fiche `VERIFIED`; dans les deux cas,
`attempt_count=2`, `updated_at` et la taille du résultat restent inchangés. Les
deux tentatives comptabilisées correspondent à la certification initiale et à
sa reprise après expiration d’un bail abandonné par un défaut CLI corrigé;
aucun nouvel appel fournisseur n’est effectué après l’état terminal.
Le run `34880368092` répète cette preuve à zéro après le dernier déploiement du
Worker et valide donc encore l’identité OIDC sans modifier D1.

### Agenda public autonome publié et certifié

Le calendrier partagé est désormais collecté exclusivement par
`.github/workflows/agenda.yml` dans le dépôt public
`tristan-monticelli/tobirink-public-discovery`. Le workflow privé Agenda ne
possède plus de planification, de permission OIDC ni d’appel fournisseur. Le
Worker ne contient plus les clients réseau AniList/MangaUpdates : il vérifie le
jeton OIDC, valide la génération et reste l’unique auteur D1.

Le run public `34888271094`, sur le commit public
`cab3b8e2965f3953cf0927d7146b970b4ae2e11e`, a réussi en 1 min 35 s et publié
765 événements réels : 239 AniList et 526 MangaUpdates, pour la fenêtre
2026-09-13–2026-09-29. Les six sorties MangaUpdates observées sans identité de
série ont été ignorées sans inventer de rattachement; ce cas est couvert par un
test de régression.

D1 confirme la génération active
`calendar-8b7baa47d143d46d6b21facd9cbc19f025990c3277334ff3`, avec les mêmes comptes
239/526 et `event_count=765`. Deux lectures consécutives de `GET /v2/releases`
ont renvoyé HTTP 200, un corps identique, la même révision et le même ETag
`releases-calendar-8b7baa47d143d46d6b21facd9cbc19f025990c3277334ff3-2026-09-13-2026-09-29`.
Le Worker final certifié est `b398b19c-3cac-4e50-9c24-86902eb03853`; la version
précédente `ca4a3757-fca5-484e-aff8-47d7801bad3f` reste disponible pour rollback. Aucune variable
secrète ni fichier `.env` Agenda n’a été créé.

### Candidate de durcissement 1.0.29

Le candidat `1.0.29` conserve `/v2/releases` pour les versions publiées et lit
le calendrier via `/v3/releases`, qui expose la fenêtre de la génération D1.
Une génération âgée d'au moins huit jours, hors fenêtre ou contenant une ligne
invalide est refusée et déclenche le repli Agenda MV3. D1 conserve la génération
active et deux sauvegardes; la collecte MangaUpdates échoue si plus de 5 % des
lignes reçues n'ont pas d'identité de série. Quand Public Discovery est
configuré, aucun chemin automatique d'identité ou de couverture ne contacte un
fournisseur depuis l'extension.

Le packaging reproductible local produit les candidats suivants, encore non
publiés : Chrome `78cd2e6755dc0d26d92c209eda082711dd0917b794f41f947e7ed4b5aa6be211`
(302755 octets) et Firefox
`532c5f69c7914e42a0b9cefc80286dbd38d5bdbd74a9d46049ab9c846ae010a7`
(302807 octets).

### Version publiée sans repli Agenda fournisseur MV3 — 1.0.30

La version `1.0.30` retire le dernier repli Agenda direct depuis l'extension.
Le background lit exclusivement `/v3/releases`; si D1 est temporairement
indisponible, il peut conserver une génération partagée de moins de huit jours,
mais ne contacte jamais AniList ni MangaUpdates. La collecte et l'hydratation
D1 restent la responsabilité exclusive du workflow GitHub public vérifié.

Les archives `1.0.29` restent immuables. Le packaging reproductible produit
Chrome `993297b5610e1f6e949ec289f4697f9f15e8f0b85b52ce6d12a54edfe2717b99`
(300921 octets) et Firefox
`7757cf8182cf54575fa69683b9d5c5f616e332a49b4e9242583c6fb97a9f7d06`
(300959 octets). Chromium 153 certifie le ZIP Chrome exact avec Agenda D1 et
zéro appel fournisseur; Firefox 155 certifie le ZIP Firefox exact avec les
sorties anime `INSTANT` et manga `DATE`.

La publication Cloudflare a été appliquée par le gate exact
`593b389092ef1a8e05deba18bde2d04534c956754ae2181e1294b1e9e03ed63a`.
Son allowlist contenait uniquement les deux objets R2 `1.0.30` et le Worker;
aucune action D1 n'était autorisée ou nécessaire. Le premier apply a refusé
avant mutation un état fournisseur devenu différent du preview, puis le plan
recalculé a publié les deux archives et la version Worker
`7278372d-1d2e-4a7c-960a-58b96d6a9b1c`, active à 100 %.

Les deux téléchargements de production renvoient HTTP 200, un contenu ZIP,
un cache immutable et exactement les empreintes ci-dessus. `GET /v3/releases`
renvoie HTTP 200 avec la révision active
`calendar-0a3ba9d67eecbb853aab521c5b57f199ec2aab49cc646f1c`; la relecture avec son
ETag renvoie HTTP 304. D1 contient 765 événements actifs, dont 239 AniList et
526 MangaUpdates, et aucune migration n'est en attente. Le dernier workflow
Agenda public observé, run `34894650534`, est réussi.

Cette absence d'egress fournisseur concerne les parcours automatiques de
Discovery et Agenda. Une décision Review manuelle contenant un identifiant ou
une URL fournisseur explicite peut encore demander volontairement
l'hydratation exacte à AniList, MangaUpdates, MangaDex ou Kitsu; elle n'est pas
une recherche automatique de titre.

### Candidate sans fournisseur MV3 — 1.0.31

La candidate locale `1.0.31` ferme aussi le dernier chemin manuel direct : un
identifiant fournisseur explicite produit une demande Public Discovery v3 et
attend la fiche D1 publiée par le collecteur GitHub OIDC. Les runtimes de
restauration d’identité, le fallback Agenda exporté et la règle DNR
MangaUpdates ont été supprimés. Les deux manifestes n’accordent comme origine
que `https://tobirink.com/*` et ne déclarent aucun ruleset DNR.

Deux constructions isolées reproduisent exactement les archives de vingt
fichiers :

- Chrome : 291601 octets, SHA-256
  `a4bf87ecc73f03566ad84d8a6b2d8ee61dae0fe6e1cbf3f9f1897afb81dbd390`.
- Firefox : 291642 octets, SHA-256
  `01657bc68988fc97360881f7a2f6bd431e52d82dbfc95440fb0ca58a545e3358`.

Cette candidate n’est pas publiée. La production, les liens de téléchargement
et le rollback restent en `1.0.30` jusqu’à une opération R2 et un déploiement
Worker explicitement approuvés et vérifiés.

### Publication D1-first et Agenda OIDC — 2026-09-14

Le gate Cloudflare `e99f9f8f175d282e33ed15e253b8be85c7be5d0019bfafd4ddff7230fcfb649b`
a appliqué uniquement la migration `0011_verified_public_discovery.sql`, les
deux objets R2 versionnés et le Worker `tobirink-public-api`. L'inspection après
publication ne rapporte plus de migration en attente et déploie la version
Worker `4f2b30ee-ef24-4ccc-aefb-e880be5fa50e` à 100 % sans cron Cloudflare.

- Chrome : 301668 octets, SHA-256 `0bc6270241192483d9dc5c4d4df7f8a4de0503298f1f7bfb3bcc4dbb2fd0fb94`.
- Firefox : 301702 octets, SHA-256 `b7d06163183190ba3202f23c5acc131666653f38055037203bd10f180eca81fa`.

Les téléchargements HTTP reproduisent exactement ces empreintes. D1 contient
la nouvelle table de claims mais encore zéro claim vérifié et zéro génération
Agenda active. Les runs GitHub `34853308267` et `34853312139` n'ont exécuté
aucune étape : GitHub les a refusés pour paiement de compte échoué ou limite de
dépense insuffisante. La collecte réelle reste donc non certifiée jusqu'à la
résolution de ce blocage externe.
Une seconde tentative autonome a produit le même résultat avant toute étape sur
les runs Agenda `34854671530` et découverte `34854675359`; aucun appel
fournisseur, jeton OIDC ou écrit D1 n'a été exécuté par ces jobs.
Ce blocage historique du dépôt privé est clos pour la découverte par le dépôt
public et les runs de certification `34879839965` et `34879931399` ci-dessus.

## Release verification

### Local library performance — 2026-09-13

### Corrected Agenda publication — 2026-09-13

The Agenda Worker and extension artifacts were published through Cloudflare gate
`3b5a999181355cc0b91e232b4092b777913c1da121c7e3230f52f6488fa4cfd6`.
The exact allowlist contained only the additive D1 migration target,
the versioned Chrome and Firefox 1.0.25 R2 objects, and
`worker:tobirink-public-api`. D1 reported no migrations to apply.

Both archives were uploaded successfully and retain immutable caching:

- Chrome: 305469 bytes, SHA-256 `c3bef1105a1b54ae8acf03cdf34d4928b9457af11cf6bc7a8a541dc1bd64cc54`.
- Firefox: 305509 bytes, SHA-256 `ffe508210a2e13f81b76b791a9cb86ad1b1624f279ab69127cd7d6b44ff1a460`.

Worker version `c1e72fad-1262-4632-8dc5-52326bb1f53a` is deployed at 100 percent
with the documented five-minute cron. The previous Worker version
`d498ddc7-55c5-41b0-890a-c1838a1e9dfa` remains listed for rollback.

The installed Chromium 153 smoke reconstructs one anime `INSTANT` entry and
one manga `DATE` entry. Production pages and API routes return the expected
statuses, the production Playwright connection-state smoke passes, and the
Agenda dataflow remains Archify showcase 9/9 with zero errors and warnings.

Certification correction — 2026-09-14: the installed Agenda smoke uses seeded
events; it does not demonstrate live provider collection. The last observed
public API responses contained an empty catalogue and `revision: d1-empty`.
These responses do not count every D1 table. The separate collector and signed
ingestion described in ADR-0045 are not established as deployed, and weekly
refresh shared with user requests is not certified. The local cache correction
documented in `docs/systems/agenda-recovery-plan.md` is not part of the
published archives above. Artifact publication must not be treated as
end-to-end Agenda certification.

### Agenda mutualisation deployment — 2026-09-14

The approved gate plan `fbc80ad5c4d55b41742ad032bc34c5f565c9bce0d9b945ef2ff183376d0b096a`
applied migration `0010_public_release_sync_state.sql` to D1
`tobirink-public` and deployed Worker version
`7e5440ab-3acb-4296-9701-54ed710d0ed9` at 100 percent. Post-deployment
inspection reports no pending migrations. The public routes return HTTP 200;
the observed catalogue remains empty and `/v2/releases` remains `d1-empty`,
so this deployment is not evidence of a successful live provider collection.

Candidate `1.0.25` keeps IndexedDB authoritative while replacing per-record
catalogue reads with bounded `bulkGet` and `anyOf(workIds)` batches. Normal
browser startup reuses the complete inventory checkpoint; opening Library does
not contact D1 or a provider. Chromium reads 500 resolved Works in about 20 ms
and a mixed corpus of 1,400 resolved and provisional favorites in about 58 ms,
below the 500 ms release budget.

Two independent builds reproduce the 21-file archives byte for byte:

- Chrome: 299491 bytes, SHA-256 `717add2b02f14d6690a2d49c9d698a1b163ffcdfd6c9e8d39724b04cf667da5e`.
- Firefox: 299539 bytes, SHA-256 `8ac0fa495c18c20af85bf81d766f925eb67ba40000621d9dc29d46c50e5756f4`.

Chromium 153 installs the exact Chrome archive and completes the automatic
1,408-bookmark journey, including structured Asura/Void titles, cache-first
routing, durable retries, pause/resume, `storage.sync` v2 reconstruction after
IndexedDB loss, encrypted backup recovery and zero imported Review. Firefox
151 installs the exact Firefox archive and passes health, ordinary-link
exclusion, empty-queue and zero-Review checks.

Cloudflare gate
`a89336a206641aaeaf023deed643a4416ffd378f5c42eed95aab4370324442fa`
uploaded only the two immutable 1.0.25 R2 objects and deployed Worker
`cc8dbe22-e626-42b4-92b4-5c639de1248b`. The production check detected that the
static download page had not been rebuilt; bounded follow-up gate
`9aac711ee8cc78b250e1c10053c59d26380dd6310257ed3303ecfdb2af9cf67c`
then deployed only the rebuilt site and Worker
`a6f03271-0ec9-4944-81ec-e5b09f611f7b` at 100 percent. Worker
`586566ea-1092-4820-b32f-c896c2a0edef` remains the pinned rollback reference.

The production download page advertises both 1.0.25 links. Each archive
returns HTTP 200 with immutable one-year caching and the exact certified hash
above. The versioned parsing rules return HTTP 200, while cover and unknown
route misses return 404. The final inspection reports no pending D1 migration
and an empty covers bucket. All six HTTP production Playwright journeys pass.
No D1 row, cover, secret, previous archive or migration was modified.

### Automatic reparse correction — 2026-09-13

Candidate `1.0.24` accepts a bounded numeric routing segment before a
release-bearing slug only when a human bookmark segment corroborates the
cleaned identity. When the semantic artifact changes, a resolved automatic
Review is archived in a correction receipt, detached from the source and
requeued; human decisions remain authoritative.

Two independent builds reproduce the 21-file archives byte for byte:

- Chrome: 299110 bytes, SHA-256 `28a8b9409cee3580ccee67f4ae48895a657777b5d4c53c7d33ba84a66ad0b8ca`.
- Firefox: 299147 bytes, SHA-256 `32e55c3317d9b1f247a522e65ea6b797ee3f3ad0001e01232a70efc3e5d1a219`.

Chromium 153 installs the exact Chrome archive and converges 1,408 bookmarks,
including the reported Asura and Void route shapes, with cache-first routing,
durable retry, `storage.sync` v2 reconstruction after IndexedDB loss, encrypted
backup recovery and zero imported Review. Firefox 151 installs the exact
Firefox archive and passes health, ordinary-link exclusion and zero-Review
checks.

Cloudflare gate plan
`e2ef2ab8c1ac436cec02414d053de3471228e4074b9cecb0eebe77cb620997e6`
uploaded only the two immutable 1.0.24 R2 objects and deployed Worker
`586566ea-1092-4820-b32f-c896c2a0edef` at 100 percent. Worker
`e5da9e96-d50a-4166-a01f-466cc5e7a4ef` remains available as the pinned rollback
reference.

The production download page advertises both 1.0.24 links. Each archive returns
HTTP 200 with immutable one-year caching and the exact certified hash above.
The final inspection reports no pending D1 migration and an empty covers
bucket. All six HTTP production Playwright journeys pass. No D1 row, cover,
secret, previous archive or migration was modified.

### Favorite title/slug alignment release — 2026-09-13

Candidate `1.0.23` ships `favorite-parser-v5`, `favorite-matcher-v4` and
`favorite-provider-search-v3`. Parenthesized aliases remain available for
provider discovery while identity proof still requires corroboration. OVA and
prepublication signals are passed through the MV3 runner. Automatic artifacts
from older versions are reparsed; human decisions remain authoritative.

The pinned read-only FavLib differential and the 82-case semantic oracle are
part of the full repository gate. Chromium 153 installs the exact Chrome
archive and completes automatic 1,406-bookmark convergence, `storage.sync` v2
reconstruction after IndexedDB loss, encrypted backup recovery, cache-first
routing, durable retry, pause/resume and zero imported Review. Firefox 151
installs the exact Firefox archive and passes health, ordinary-link exclusion
and zero-Review checks.

Two isolated builds reproduce the 21-file archives byte for byte:

- Chrome: 298903 bytes, SHA-256 `783c88c71401f23d8cb6134a4688ddd00cc12307468018f002a8404216eebe02`.
- Firefox: 298939 bytes, SHA-256 `20f3bf65bfb74be7912544fd8903cbdc7acee269eae84b8962a1c05e70e69625`.

Cloudflare gate plan
`6dc2ade94d7b48a1bfb28bcf376a54fc81f7352e9040b8b96b01543bba139457`
uploaded only the two immutable 1.0.23 R2 objects and deployed the Worker. A
production probe then exposed stale prebuilt website assets before release
certification could finish. After rebuilding the static site from the same
certified source, follow-up gate
`be5b171c13a489e071a83603751f4639d73b1f6f0d318fee128835423b2c0eb3`
redeployed only the Worker and those versioned assets. Worker
`e5da9e96-d50a-4166-a01f-466cc5e7a4ef` is active at 100 percent; Worker
`bec0dbe6-7952-4fb1-8aca-4c50f49c4d06` remains the pinned rollback reference.

The production download page advertises both 1.0.23 links. Each archive returns
HTTP 200 with immutable one-year caching and the exact certified hash above.
The final inspection reports no pending D1 migration, the covers bucket remains
empty, and all six HTTP production Playwright journeys pass. No D1 row, cover,
secret, previous archive or migration was modified.

### Persistent recovery release — 2026-09-12

Candidate `1.0.21` publishes a validated `storage.sync` v2 snapshot for a
1,406-source inventory during one bounded MV3 wake, then reconstructs an empty
IndexedDB from exact provider IDs without a title search. Options also exports
and restores a local AES-GCM private archive containing Library, progression,
Review, organization and the opaque collective identity. A wrong phrase or
altered archive does not mutate IndexedDB. A local journal plus the IndexedDB
v14 receipt converges a service-worker interruption before or after commit.

Store-installed builds follow their store’s signed update channel. Chrome or
Firefox builds loaded manually from an unpacked directory or temporary archive
do not consume TobiRink’s versioned ZIP automatically; load the new candidate
into the same browser profile, or export the encrypted private backup before
removing the old installation. The backup phrase is never stored or sent.

The deterministic 21-file candidates are:

- Chrome: 298029 bytes, SHA-256 `c0c93e66d560660e1d8f6383813f800e4249cf4844c45784badfdec134a441b1`.
- Firefox: 298066 bytes, SHA-256 `c22b612d6f2186fd41a1c0deead265a17dfb94a3b9e26996c2344f31d603a447`.

After the explicit publication request, Cloudflare gate plan
`1bd21ee11f893acffd30c7db5befeadf4217eb9ac2fdfe3603be467ac0f85b02`
uploaded only those two immutable R2 objects and deployed the release Worker.
The first production probe found that its static `/download` asset still
advertised 1.0.19. The site was rebuilt from the committed 1.0.21 source, then
the Worker-only gate
`e9b7d95843498721b75b04407ccd826aa64f5022dee37251ba507abdd065901c`
deployed Worker `c1eef241-0eed-4f2c-b389-598f0106763d` at 100 percent with 28
updated assets. The final page advertises both 1.0.21 archive links. The final
inspection reported no pending D1 migration, both public downloads returned
200 with immutable caching and their certified hashes, and all five production
Playwright journeys passed. Worker
`9883cbfe-b776-4199-96b5-71ff0bfde881` remains the pre-release rollback
reference.

### Cache-batched automatic convergence candidate — 2026-09-12

Candidate `1.0.20` recovers a cleaned bookmark title only when a generic route
contains an explicit chapter, episode or volume proof. Ordinary resources and
utility routes stay unsupported. Before provider title searches, the extension
deduplicates normalized keys into batches of at most 50 and prepares sync,
owner-scoped and public D1 caches. The public Worker contract contains only the
fingerprint, media kind and parser/rules versions. One prepared D1 query returns
at most two confirmed identities per key; a cache failure remains independent
from provider retries.

Chromium 153 installed the packaged archive into a fresh profile containing
1,406 bookmarks. Without a reconciliation click, its MV3 alarms completed the
inventory and presence phases, then reported 1,401 ordinary links unsupported,
one D1 resolution, four provider retries, zero pending work and zero Review.
The local library retained five media projections, including the generic
opaque release route. Three cache requests preceded the two bounded AniList
title-alias requests. Pause/resume and an explicit service-worker stop/restart
preserved the projection and continuation alarm. Firefox 151 installed its
archive and passed health, ordinary-link exclusion and zero-Review checks.

The focused recovery matrix passes 41 application tests for timeout, HTTP 429,
incomplete pages, corrupted sync generations, interrupted checkpoints and
automatic-attempt blocking, plus 16 extension tests for inventory continuation,
alarm restoration and persisted pause. The pinned synthetic FavLib differential
passes both suites over its 82 anonymized cases; no private FavLib content is
read or emitted by this release step.

Two isolated builds reproduce 21-file archives byte for byte:

- Chrome: 294080 bytes, SHA-256 `39ff7a129d6ee068ef33c097128a1f6b12b379cacd23bf09d26eb5c84a7da77a`.
- Firefox: 294125 bytes, SHA-256 `2140796db5a3eef1d40610fccde6121a7fdbe84e9cb5810ed2614a80212eddcd`.

Publishing these archives and deploying the matching Worker remain a separate
Cloudflare operation requiring a reviewed allowlist and explicit approval.

### Internal pagination and owner ambiguity release — 2026-09-12

Release `1.0.19` keeps the Library continuation cursor inside React state,
appends unique cards to the same grid and leaves the public URL limited to
user-selected search, sort and facets. Review carries provider covers through
the local runtime and WebBridge, derives the controlled R2 fallback from the
public provider ID, removes the 24-hour defer action and retains previous/next
navigation.

Migration `0006_owner_ambiguity_sets.sql` stores two to six competing public
provider identities for one opaque owner and normalized key. It stores no raw
title, favorite URL, folder, progress or cover URL. Lookup returns the set only
to that owner; the extension hydrates it into the private candidate set and
still requires a human choice.

Cloudflare gate
`436dc18fc53d981cbbc81a1522a532f8f453a0b41ad5b7bf6ef858db330b9447`
applied migration `0006`, published both immutable archives and deployed the
release Worker. Production verification found that Next remounted the Library
after a facet URL update, so corrective commit `918ef6c` keeps the current page
and updates the filtered URL without triggering a route transition. The
Worker-only gate
`ebbb8d912bab08e414f6bf74e85f912c192ad26e18e8fae34c039a43bc3e3659`
deployed Worker `9883cbfe-b776-4199-96b5-71ff0bfde881` at 100%; Worker
`2262ea78-5dc7-4680-a5f5-e5bb17f7f344` and the former 1.0.18 Worker remain
rollback references. Wrangler lists no pending migration, all seven production
Playwright journeys pass, five pages and `/v2/favorites/rules` return HTTP 200,
and an unknown route returns HTTP 404.

Two isolated builds reproduce 21-file archives byte for byte. Chromium 153
loads the final Chrome archive and completes the 1,405-bookmark cache-first
journey; Firefox 151 loads the final Firefox archive and passes its installed
smoke:

- Chrome: 292064 bytes, SHA-256 `14fb88450dbffbda2531472c77fb28511685bb763537cedfc9b51852b0bdb202`.
- Firefox: 292109 bytes, SHA-256 `93dcb8d431ba4bbc58f7174e8af98eceb34344a05dcdc686bf780f2e3d3f485d`.

### Complete favorite-pipeline release — 2026-09-12

Release `1.0.18` réunit la résolution fournisseur bornée, le cache collectif
owner-scoped à consentement explicite, la reprise `storage.sync` courant +
rollback, les mutations de favoris incrémentales, le curseur durable de
réparation des couvertures et le différentiel FavLib épinglé sur fixtures
synthétiques. Aucun contenu privé FavLib n’entre dans le dépôt ou les logs.

L’archive Chrome a convergé depuis un profil vierge sur 1 405 favoris
synthétiques : anime explicite, manga explicite, manhwa avec suffixe de routage,
type inconnu résolu par cache D1, trois pannes fournisseur en reprise et 1 401
liens ordinaires exclus. Elle effectue deux lectures D1 avant recherche, zéro
recherche AniList par titre, crée zéro Review à l’import et conserve quatre
entrées après arrêt puis réveil du service worker MV3. Firefox 151 installe
l’archive distincte, répond au health check, exclut le lien ordinaire et garde
la Review vide.

La gate Cloudflare
`a82d7ab5102a492d4568ab8fee013f21e089ec1f74f9cc40533cd4c2310f18af`
a appliqué `0005_public_favorite_cache.sql`, publié les deux archives et déployé
le Worker `5b6b4734-fb5b-429f-bced-7552dea0d418`. Wrangler ne liste plus de
migration en attente. Les probes production confirment `1.0.18` sur `/download`,
les cinq pages publiques en HTTP 200, les règles publiques en HTTP 200, et les
misses cache D1 et cover R2 en JSON 404 `no-store`. Les sept parcours
Playwright de production passent.

Deux archives locales déterministes de 21 fichiers ont été produites :

- Chrome : 291468 octets, SHA-256 `823b299be7491414234fcf955051956df68873eb11feea153995587950a5fe33`.
- Firefox : 291513 octets, SHA-256 `49d9d711e54a3cf67f1f854e22c75ac00607d63ceaa094f5f2172ebf278a1fe2`.

### Cache-first reconstruction candidate — 2026-09-12

Candidate `1.0.17` adds un manifeste `storage.sync` v2 qui relie les empreintes
normalisées aux identifiants fournisseurs publics tout en relisant les
générations v1. Chaque restauration, scan de publication et écriture fragmentée
incomplète programme son prochain réveil MV3. La résolution consulte
l’association synchronisée et le cache D1 public avant la recherche fournisseur.
Les batches authentifiés et idempotents alimentent la table additive
`favorite_public_cache` avec une fiche publique validée; deux identités pour la
même empreinte restent non résolues.

La certification locale crée 1 404 favoris. Elle projette les trois liens média,
laisse 1 401 liens YouTube ordinaires hors prise en charge, résout un titre
générique depuis le cache D1 simulé avec zéro recherche de titre fournisseur,
conserve deux pannes exactes en reprise, programme l’alarme durable et crée zéro
Review à l’import. Deux constructions isolées reproduisent exactement :

- Chrome : 289689 octets, SHA-256 `bd12bc3efa47cfc4760bc266b92b5e81b16f7d11ff68898bc1aa04fd862af464`.
- Firefox : 289734 octets, SHA-256 `7d958eec497af9541a96e2b893320ee3d2b6996f2462ce13f5f754ed16e4a198`.

La production sert encore `1.0.16`; la migration `0005`, le
Worker et les ZIP relèvent de la gate Cloudflare séparée.

### Local-first library candidate — 2026-09-12

Candidate `1.0.16` restores the FavLib property that a parsed browser favorite
is visible before provider hydration. The catalogue merges resolved `Work`
records with read-only provisional projections from observed `FavoriteSource`
and parse artifacts. Pending, retryable and Review entries retain a deterministic
local identity and source URL; `UNKNOWN` is explicit. Unsupported ordinary links
remain absent. Resolution replaces the provisional entry without a duplicate or
an IndexedDB migration.

WebBridge v4 carries the explicit media and resolution states to the matching
site client. The Chromium 153 installed journey scans 1,403 bookmarks while
AniList, MangaUpdates and the collective return synthetic 503 responses. It
projects both the exact AniList title and the pending MangaUpdates manga,
commits 1,401 YouTube links as unsupported, schedules both retries and creates
zero Reviews at import. The current deterministic artifacts are:

- Chrome: 288483 bytes, SHA-256 `b565e7d517a612cb1180365d8ce6be61b1de1ec40bb9049da5790e6d83408dc1`.
- Firefox: 288528 bytes, SHA-256 `cdcf41bff28fa22a3c5b00a3e73fe617a583c0e7a3debceb2a8b6a0c1ca22a1c`.

PR #23 merged the release branch into `main` as
`d6ebdc672706a28df3b0afe33bf5bd85c624d901`. GitHub did not start its hosted
jobs because account payments or the Actions spending limit require attention;
the administrative merge used the passing local verification and repository
push hooks as evidence instead.

Approved Cloudflare gate plan
`47e88cad87a5fe48e0b75da58c76f1c7e9366f314ef78461a35c683ac3fe1127`
published only the two versioned archives and Worker
`f000c895-35a5-480c-b913-8e6b041f49f8` at 100 percent traffic. Both public
downloads return HTTP 200 and match the hashes above. `/download` advertises
1.0.16; `/`, `/library`, `/agenda`, `/download` and `/privacy` return HTML 200,
and an unknown route returns JSON 404. The seven production Playwright journeys
pass, including the packaged extension's multi-provider resolution and offline
reload.

No D1 migration, deletion, secret change or R2 cover population occurred.
Worker `1ac73214-008b-4d56-a3d3-be7c1162ba9d` and the immutable 1.0.14 archives
remain rollback references. An unpacked browser installation still requires a
manual reload or replacement with the 1.0.16 package.

### Durable continuation candidate — 2026-09-12

Candidate `1.0.15` resumes separate inventory and presence phases with one
named MV3 alarm. A presence page and its checkpoint commit in the same
IndexedDB transaction, and only the last page can mark the inventory complete.
Every service-worker evaluation restores the named alarm from the active
checkpoint or the earliest READY, RETRY_AT or expired CLAIMED deadline. The
periodic reminder only repairs that alarm; it does not run the resolver.
Installation, update, startup and bookmark mutations refresh browser authority.
The trusted manual action resumes an active checkpoint and rescans only after a
completed checkpoint. This candidate remains local; publication is approved
separately.

The Chromium 153 installed journey starts with 1,402 bookmarks, converges the
multi-wake inventory and presence phases, retains one retryable provider outage,
commits 1,401 ordinary links as unsupported, creates zero Reviews at import and
keeps a durable retry alarm. Options exposes the current phase, automatic wake
and safe resume action. Two isolated builds reproduce exactly:

- Chrome: 287880 bytes, SHA-256 `780ebef687c390d15637802f67de09e5e1f7162657977c3028952fa8f3b00935`.
- Firefox: 287925 bytes, SHA-256 `34fb16d5f66be819e33472cfbb07d59a03266ce8917457752e6df26054656841`.

### Locked diagnostics candidate — 2026-09-12

Candidate `1.0.14` keeps a 100-event local ring for inventory and resolution
lifecycle states. The exact local value `extension-v1` enables it and Options
can write `off` without deleting prior evidence. The Worker emits only bounded
technical JSON when its exact non-secret value is `worker-v1`; raw paths,
queries, headers, bodies, errors and favorite content are excluded. Diagnostic
failures are isolated from resolution. Publication does not run a D1 migration.

La gate complète, le paquet Chromium isolé et le parcours multi-fournisseur
passent. Deux constructions indépendantes reproduisent exactement :

- Chrome : 286771 octets, SHA-256 `98811bff45e3670c7eda5f62aee211dd64abe0460c4832ed2ded9d4419e8cf1d`.
- Firefox : 286816 octets, SHA-256 `3587e5c305fd69ae503b28b664d27e6ee5ffff6438ed79a2f2f9ee540c8ca04a`.

Le plan Cloudflare
`f3c49715496e45632b8d2889b434e6257b7afe49113801a2ab83cbe3041454fe`
a publié les deux objets et le Worker
`1ac73214-008b-4d56-a3d3-be7c1162ba9d` à 100 %, sans migration D1. Les deux
téléchargements publics reproduisent les hashes ci-dessus, `/download` annonce
1.0.14 et les sept parcours de production passent. Un tail réel a corrélé le
header `X-Tobirink-Request-Id` avec un événement `worker.request` de famille
`release`, statut 200 et durée bornée, sans contenu applicatif. Conserver le
Worker `a7fa4736-3915-4608-b97e-ddb7a99da750` et les ZIP 1.0.12 comme rollback.

### Live queue diagnostics candidate — 2026-09-12

Candidate `1.0.13` exposes the observed favorite count and inventory checkpoint
in Options. Its primary action performs an actual bounded reconciliation and
library projection repair; the secondary action only refreshes the counters.
Both commands are restricted to the trusted Options page. This makes an empty
inventory distinguishable from an active scan or queued provider work. It does
not yet prove recovery of the user's private profile and is not published.

The packaged Chromium journey creates six browser bookmarks, opens Options,
activates « Relancer l’analyse », observes a complete six-item inventory, then
verifies five resolved media works and one excluded ordinary YouTube link.
`npm run verify`, the Chromium migration suite and Archify showcase pass. Two
isolated builds reproduce these local archives:

- Chrome: 285618 bytes, SHA-256 `b9e9cbb9b4ae29ccb79f1f877fd0f3566abd6cc11b55fe4a00fffb221e6961a1`.
- Firefox: 285663 bytes, SHA-256 `0efaaa3cb01bb2423233d1b279a9946ae99b81eedb39c3108ed48eca8fbf9f59`.

### Robust pipeline release — 2026-09-12

Release `1.0.12` restores D1 exact-ID hydration recovery,
independent provider restoration, dated internal retries, root release routes,
honest MangaDex pagination and linked MangaUpdates hydration. Provider response
limits are 512 KiB, separate from the 64 KiB bridge. Library reads, message
schemas and repair no longer stop at 500 works. Primary metadata upgrades
preserve existing work identity. Cover failures attempt one ID-based Worker
lookup for an already ingested R2 master; no production covers were populated.

The packaged Chromium journey passes with five resolved synthetic works,
MangaUpdates metadata for the explicit MangaDex cross-reference, provider
covers without referrers, zero imported Reviews, excluded ordinary YouTube
and offline reload. A separate synthetic 1 400-work IndexedDB projection in
that installed extension validates its late cursor through the runtime message
boundary. This projection test does not claim 1 400 live provider resolutions.
Six website journeys pass, including connection states and persistent facets.
The Firefox 151 isolated installation smoke passes health, ordinary bookmark
exclusion, empty Review queue and zero imported Review.

The complete `npm run verify` chain passes, including workspace tests,
typechecks, performance checks, CRG smoke, integration and dependency audit
(zero vulnerabilities). Archify showcase passes 9/9. The separate Chromium
IndexedDB migration suite and the production website build pass. Native
Firefox evidence is the installed smoke above, not the complete migration suite.

Two isolated builds reproduce the final local archives:

- Chrome: 285247 bytes, SHA-256 `4b6642dfe4008ccb1d2ca1a57bfbdf48ebdc41d79e537d2bdbe3a37456cb961b`.
- Firefox: 285292 bytes, SHA-256 `014de4344a0e7781eef8b74e3ee2a09b1073a9d6e3d6ff39dfc37a6d6d29aaf7`.

The source comparison used FavLib read-only, including historical `3267de2`,
to identify omitted release routes and retry isolation. No FavLib private
database was imported or committed. The synthetic equivalence snapshot changes
only adapter versions and their fingerprints; it is not evidence of parity
with the user's private corpus.

After the user's explicit deployment request, gate plan
`808bb95417403e2a782da2c72af17453634ecc5b0e647b5f1d7fc30b0fcacdda`
published both ZIPs and Worker `a7fa4736-3915-4608-b97e-ddb7a99da750`.
Public downloads return HTTP 200 and match both hashes above; `/download`
advertises 1.0.12 and `/library` and `/agenda` return HTTP 200.
The Playwright run against the production base URL passes 7/7; provider data
and bridge fixtures remain synthetic. Previous Worker
`6d02c19a-9760-44ae-ab89-26e82bbc77e0` and the 1.0.11 archives remain the
rollback references; its deployment snapshot is retained locally.

No D1 migration was applied and no user data was deleted. Populating R2 cover
associations and verifying the user's actual installed profile remain separate
operations. Publishing a ZIP does not update an unpacked browser installation.
The user's `.codex/config.toml` change remains outside these commits.

### Comix route correction candidate — 2026-09-11

Candidate `1.0.11` recognizes exact Comix title/chapter routes as manga and
keeps newer bundled rules when an older owner cache is present. Forty targeted
tests pass, including reimport of an unsupported source without data deletion.
The packaged Chromium journey resolves its synthetic Comix bookmark through
MangaUpdates and verifies that no anime query is issued for that title.
Two isolated builds reproduce both archives:

- Chrome: 283267 bytes, SHA-256 `66c467b1e11f89bc9f18ddc7c57a9c996db4ae53b494a7740ec41ce1315529ea`.
- Firefox: 283311 bytes, SHA-256 `69e5ff42bf685e6ff1366fd1e08054db00c06101267d6ce549ebf5fce891b2bb`.

`npm run verify` passes. Gate plan
`45d191ea218c83a1832adbbd8338da5a09ad4a07627fdd76fa16e73e0a7d6070`
published both ZIPs and Worker `6d02c19a-9760-44ae-ab89-26e82bbc77e0`.
Public downloads match the hashes above, `/download` advertises 1.0.11,
and `/library` returns HTTP 200. No D1 migration was applied. Previous Worker
`63799f79-d60f-448f-8291-2ca46f091dad` remains the rollback reference.

The user's site tab was observed empty. Its installed extension version and
queue diagnostics remain unavailable through the browser control adapter;
these local tests do not certify recovery of the complete private library.

### MangaUpdates transport candidate — 2026-09-11

Candidate `1.0.10` restores the API-specific Origin header rule, keeps HTTP
403 retryable instead of selecting MangaDex, and accepts absent provider image
URLs. Installed Chromium 153 reproduces 403 with the rule disabled and 200
with 25 results when enabled. A separate live public query passes through the
real adapter, paginated checkpoints and matcher and resolves to MangaUpdates.
The packaged multi-provider import, WebBridge and offline journey passes.
Two isolated builds reproduce both archives:

- Chrome: 283003 bytes, SHA-256 `82401ff3a8dfb1e122d0a63dcfd451f1eb42f6d01e2d6b8fc5e9a56f7da17612`.
- Firefox: 283048 bytes, SHA-256 `58bd2bb00d3a9e7b82e9ebeae63d5469cf5984b9ba5a7b297d45084b355d9f3e`.

`npm run verify` passes. Gate plan
`2b25ce4cd70d15a02ed4715fee463696912978b2ee0131406bedc06842d96672`
published both ZIPs and Worker `63799f79-d60f-448f-8291-2ca46f091dad`.
Public downloads match the hashes above and `/download` advertises 1.0.10.
No D1 migration was applied. Previous Worker
`0721e450-0098-43fd-ae64-923640b332f1` remains the rollback reference.
The user's installed-profile reload remains unverified.
Previously stored MangaDex identities remain preserved; this
candidate does not certify complete migration of that private library.

### Cover and queue correction candidate — 2026-09-11

Candidate `1.0.9` passes `npm run verify`, the current-archive multi-provider
Playwright journey and the installed Chromium Review smoke test. Two isolated
builds produce identical archives:

- Chrome: 282615 bytes, SHA-256 `e4c7412a62ac49239d2e8a12204570d82c0c54ee2f82e32eb60deed844b1b2fe`.
- Firefox: 282663 bytes, SHA-256 `372956d453f152a1f44e420fb75594ddb8dc995863423fdfc38c5ce6738b102b`.

Live Chrome inspection reproduced a MangaDex replacement image served with
HTTP 200; the same public diagnostic URL without a Referer decoded as the real
512-by-728 cover. The packaged journey checks decoded images and absent Referer
headers for the provider fixtures. Native Firefox installation was not verified
for this candidate. This evidence does not certify the complete private library.

Publication completed through gate plan
`8b4518333f37265a97114c96d62c93fee2b449b0dd857a53ca635c0f6a4cc64b`:
Worker `0721e450-0098-43fd-ae64-923640b332f1` serves the updated site and both
versioned ZIPs are uploaded. Public downloads return HTTP 200 and match the
hashes above; `/download` advertises 1.0.9 and `/library` returns HTTP 200.
Cloudflare credentials were loaded in memory from the user-designated legacy
environment file; no secret was copied into this repository. No D1 migration
was applied. Retain previous Worker version
`037cb356-d934-4814-b283-ae09e43e6582` as the rollback reference.
The browser control adapter cannot claim Chrome's internal extension manager,
so the user's installed extension has not been reloaded. Installed private
library certification remains pending that reload.

### Favorites queue correction — 2026-09-11

Release `1.0.1` contains the deterministic favorite-resolution correction:
generic media slugs are retained as `UNKNOWN` for independent provider lanes,
and the local queue drains up to 100 claims per wake while remaining bounded by
the 20-second MV3 wake budget. The package is versioned separately so browsers
cannot serve the immutable `1.0.0` archive after an update.

### FavLib correction deployment — 2026-09-08

The approved Cloudflare plan applied additive D1 migration
`0004_favorite_owner_resolution.sql`, published both 1.0.0 browser archives,
and deployed Worker version `5739481c-21a2-4763-9cc3-67b40aa61b3e` at 100%.
Remote D1 inspection reports no pending migration and a bounded read confirms
the owner-scoped tables, covering indexes and triggers without writing data.

The R2 objects and the public downloads are byte-identical to the packaged
candidates: Chrome is 273,208 bytes with SHA-256
`092f7c3e7cf17ebfb8e309ec56523631e766d2641d474e4d0c72a35bb321fd58`;
Firefox is 273,254 bytes with SHA-256
`b2ed10d07fa702bac05ec520874a60cbec84c417963bf837dc016f9c1ad15b0c`.
Both public responses use `application/zip`, an attachment disposition and the
immutable one-year cache policy. The production Playwright suite passes 7/7,
including the packaged Chrome extension, WebBridge, offline recovery, Library,
Review and Agenda. Provider matching in this release test uses a deterministic
AniList response; a separate live probe returned HTTP 403 from the validation
host, and the extension correctly retained a retryable state without producing
a no-match or Review.
The final repository gate now passes after the MCP manifest validator learned
to distinguish a declared server from its nested tool configuration. The
Firefox output passes `web-ext lint` with zero errors and zero notices; its four
warnings are dependency-generated Zod and React DOM paths documented in the
browser and accessibility evidence.

For the FavLib correction, run
`node scripts/release/package-extension.mjs --verify-isolated`.
It builds each browser target twice in separate fresh directories under
`build/.output/`, compares the complete archive bytes across builds, and retains both
archives and their hashes. Existing package and download paths are untouched.
This proves reproducibility only; installed-browser checks and the real FavLib
oracle remain separate acceptance requirements.
The Chromium Review journey can load an archive produced by that command with
`node apps/extension/scripts/installed-review.mjs <local-chrome-zip>`.
It extracts the trusted local candidate into a fresh temporary directory,
records the archive SHA-256, and installs that content in an isolated profile.
For Firefox, set `FIREFOX_BIN` to an already installed test executable and run
`node apps/extension/scripts/installed-firefox.mjs <local-firefox-zip>`.
The script uses Firefox's native Marionette `Addon:Install` with `temporary`
enabled in a fresh profile, then checks health, exclusion of an ordinary
bookmark, an empty Review queue and zero Review records. It does not change
signature preferences or the user's browser profile. The transport follows
Mozilla's [Marionette documentation](https://firefox-source-docs.mozilla.org/python/marionette_driver.html).

1. Run `npm run package:extension`.
2. Run `npm run verify` and retain its output with the release candidate.
3. Compare each ZIP SHA-256 with `release-manifest.json` before transfer.
4. Load the exact ZIP in the matching browser and complete the manual journeys.
5. Retain the accepted ZIP and manifest outside the generated build directory
   before creating the next version.

For `1.0.0`, the local publication candidates are exactly:

- `tobirink-chrome-mv3-1.0.0.zip`
- `tobirink-firefox-mv3-1.0.0.zip`
- `release-manifest.json`

The `1.0.0` publication was applied through the separately approved provider
gate. Future publications replace the placeholders with their reviewed account,
plan path and digest in this exact repository-owned command sequence:

```sh
npm run infra:inspect -- --account <cloudflare-account-id>
npm run infra:plan -- --account <cloudflare-account-id> --operation r2-publish:tobirink-chrome-mv3-1.0.0.zip --operation r2-publish:tobirink-firefox-mv3-1.0.0.zip --operation worker-deploy
npm run infra:apply -- --plan <reviewed-plan.json> --approve <plan-sha256> --account <cloudflare-account-id> --allow r2:tobirink-public-releases/downloads/tobirink-chrome-mv3-1.0.0.zip --allow r2:tobirink-public-releases/downloads/tobirink-firefox-mv3-1.0.0.zip --allow worker:tobirink-public-api
```

These commands are documentation, not authorization.
The plan preview binds the two ZIP byte hashes and the Worker dry-run output to
its digest; the apply gate repeats both checks immediately before mutation.

An agenda snapshot is published independently with matching
`r2-release-snapshot:<revision>` and `r2-release-pointer:<revision>` operations.
The repository gate reads only the canonical files under `build/releases/`,
validates the strict public schema, hashes both inputs, and writes the immutable
snapshot before changing `releases/current.json`. D1 is not involved.

### Agenda provider hardening publication — 2026-09-14

Release `1.0.29` and the hardened Agenda pipeline were published through the
reviewed Cloudflare gate plan
`3faa51ed4b06bb4e942f7e411a099a48bc3ea15f9b9ab902fb710e495f93e467`.
Worker version `5d55c52d-3f50-473b-8bdf-62f1d30fa81c` is active at 100%; D1
reports no pending migration. The public collector source is commit
`3d2f570819f716c41667160a2e48c80d95c36415` on `main`.

GitHub Actions run
[`34894650534`](https://github.com/tristan-monticelli/tobirink-public-discovery/actions/runs/34894650534)
passed its 47 tests and published active generation
`calendar-0a3ba9d67eecbb853aab521c5b57f199ec2aab49cc646f1c` for
`2026-09-13` through `2026-09-29`. D1 contains 765 active events: 239 from
AniList and 526 from MangaUpdates. MangaUpdates received 532 rows and skipped
6 unidentified rows, below the quality rejection threshold. D1 retains one
active and one staging generation, within the active-plus-two-backups limit.

Live `/v2/releases` and `/v3/releases` reads returned the same active revision
and a stable 100-entry first page. The v2 response retains only its legacy
top-level keys; v3 additionally returns the source window. A repeated v2 read
was byte-identical with SHA-256
`47e2a530014663b0def1bc8960436b97587bad5304f6d1d0b115982c35ab3e59`.
Conditional reads returned HTTP 304 on both routes. Public GET requests read D1
only; provider collection remains isolated in the scheduled or manually
dispatched GitHub workflow.

The published archives are byte-identical to the verified local candidates:

- Chrome: 302755 bytes, SHA-256 `78cd2e6755dc0d26d92c209eda082711dd0917b794f41f947e7ed4b5aa6be211`.
- Firefox: 302807 bytes, SHA-256 `532c5f69c7914e42a0b9cefc80286dbd38d5bdbd74a9d46049ab9c846ae010a7`.

Retain Worker version `b398b19c-3cac-4e50-9c24-86902eb03853` as the immediate
rollback reference. The successful workflow emitted a non-blocking GitHub
warning that pinned action releases still declare the deprecated Node.js 20
action runtime; GitHub executed them on Node.js 24, matching the workflow's
configured application runtime.

The closing audit found that this Worker deployment had reused a previously
built `apps/web/out`, so `/download` still advertised 1.0.25 even though the
verified 1.0.29 objects were already available. The infrastructure driver now
rebuilds the web workspace before both `worker-deploy` preview and apply, and
aborts before Wrangler when that build fails. Final production evidence must
not be recorded until `/download` serves both 1.0.29 links.

## Rollback

### Agenda certification correction — 2026-09-14

The local 1.0.27 candidate binds the default native `fetch` receiver in the
browser HTTP adapters. The installed Firefox run exposed the previous
`fetch called on an object that does not implement interface Window` error.
The Firefox harness uses Marionette throughout and enables system access only
for its isolated temporary profile, as required by current Firefox automation.
Both Firefox 155 and Chromium 153 reconstructed a synthetic anime INSTANT and
manga DATE after the correction. This proves local projection, not live shared
provider ingestion. The adapter suite passes 86 tests, including a regression
test that enforces the native fetch receiver. The complete `npm run verify`
passed after the transport correction.

Production Worker `4f2b30ee-ef24-4ccc-aefb-e880be5fa50e` and the published
1.0.27 archives include this correction. The public Agenda route still returns
`d1-empty` because GitHub billing prevented both collector jobs from starting.
The 1.0.27 Worker contains a weekly GitHub Actions collector and strict GitHub OIDC
ingestion; it removes both the Cloudflare cron and provider calls from public
GET requests. Replays are idempotent and older generations cannot replace the
active pointer. This architecture is not production-certified until a real
cycle populates D1. No Agenda secret
or committed `.env` value is required.

Rollback never mutates local user data and is never automatic.

1. Stop distribution of the current candidate.
2. Select the latest previously accepted artifact whose version differs from
   the rejected version and whose SHA-256 still matches its retained manifest.
3. Reinstall or resubmit that exact browser-specific ZIP through the manual
   browser/store process.
4. Re-run the critical local/offline journeys and confirm that the IndexedDB
   schema is compatible before resuming distribution.
5. Record the rejected version, retained version, hashes and reason.

`scripts/release/package-extension.test.mjs` proves that packaging is stable
under input reordering and that rollback selection refuses a missing verified
previous artifact.

## TobiRink preversion and clean-room cutover

The TobiRink candidate is evaluated beside FavLib. The candidate uses a fresh
extension identity, `tobirink-local-v1`, the isolated Worker/D1/R2 names in
`apps/worker/wrangler.jsonc`, and a separate static export. No FavLib database,
ID, artifact or Cloudflare resource is read during this comparison.

Before a human approval, retain the following evidence together:

1. `npm run package:extension` output and the Chrome/Firefox SHA-256 manifest.
2. `npm run archify:validate -- tobirink-ux.dataflow` and the UX/accessibility,
   bridge, security and performance results.
3. The static site export and Worker route smoke checks.
4. The exact resource inventory from `npm run infra:inspect`, followed by a
   reviewed `npm run infra:plan` for the intended operations.

The cutover is one manually approved operation covering the domain, Worker and
download pointers. `infra:apply` is invoked only with the reviewed plan digest,
account and exact resource allowlist. No CI workflow, hook or package script
performs that apply automatically.

If the candidate is rejected, restore the retained FavLib site/Worker and
previous download artifact through the same manual process. Do not migrate,
delete, convert or otherwise touch the new TobiRink IndexedDB database. Record
both artifact hashes, the restored version and the reason before resuming work.
