# Extension packaging and rollback

## Build a release candidate

The current production release is `1.0.24`; its published archives match the
verified local candidates.
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

## Release verification

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

## Rollback

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
