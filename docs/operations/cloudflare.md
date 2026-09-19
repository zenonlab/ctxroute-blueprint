# Cloudflare operations gate

Tobirink does not expose Wrangler as a release command. Every provider change
starts from the repository-owned gate, while the extension and Worker runtime
remain independent of this operational path.

## Inspect

### Publication pipeline 1.0.39

La version du 19 septembre 2026 corrige les reprises R2/Queue,
la publication D1 et la propagation des modèles dans l'extension. Aucune
migration D1 n'est nécessaire. Les deux nouvelles archives ont été publiées
et relues avec leur SHA-256 avant avancement du pointeur vers `1.0.39`.

Archives reproductibles par deux builds isolés, conservées sous
`apps/extension/.output/packages/` :

| Archive 1.0.39 | Octets | SHA-256 |
| --- | ---: | --- |
| Chrome MV3 | 298429 | `a1939c4366d7710ad10bfe1405c610a16c4291d6dce76b2a52ee7bbb6b899d9e` |
| Firefox MV3 | 298470 | `52757a0b93b2957aa59fb09d297569201270e4b0ca44f3c9d719b1ac3e4538cd` |

Chromium 153 conserve le même identifiant d'extension, 1532 sources et 1400
médias hors ligne lors de la mise à jour 1.0.38 vers 1.0.39. Firefox 155
reconstruit l'Agenda INSTANT/DATE et traite les 1532 fixtures plus ses quatre
favoris initiaux, sans résolution inventée ni blocage. Ces profils synthétiques
ne certifient pas la bibliothèque personnelle.

Après un premier échec d'authentification, l'inspection a réussi : Worker
`a66e751f-6a83-4757-bff6-2778bfb361bf` à 100 %, aucune migration en attente.
Les deux uploads utilisent le plan
`ea8571dd37142bef1cab97027a4ad29840fa6db2d399206654e3154b673f160c`.
Leurs téléchargements publics correspondent aux empreintes ci-dessus.
Le plan Worker, limité à `worker:tobirink-public-api`, est
`f4527afdc4a59044f3b244d28c78e0abf97b8b1d4208c4ca4a6f38d6f8e5652c`.
Toutes les anciennes archives et données restent conservées pour le rollback.

Le Worker `d0ee8131-fae9-4078-80e9-2e61be7ee847` est confirmé à 100 %.
Les cinq pages publiques répondent 200; `/download` contient les deux liens
1.0.39. Agenda v3 et v4 répondent 200. Deux pages v3 partagent la même
génération et possèdent des ETags différents; la requête conditionnelle de
la même page répond 304. La route v4 n'a pas encore de modèles courants
(`generatedAt` à l'époque Unix); v3 sert les annonces historiques. Aucune
collecte supplémentaire n'a été forcée pour masquer cet état : la collecte
hebdomadaire conserve sa cadence et une date nouvelle attend sa publication.

Le canary installé 1.0.39 a réussi sur Chromium 153 : deux prélectures
retardées de six secondes, deux POST réels du service worker, deux admissions
déjà `VERIFIED`, trois lectures vérifiées et deux œuvres résolues après alarmes
natives. Il prouve la lecture/admission et la propagation vers l'extension;
il ne prouve pas une nouvelle collecte fournisseur ni une publication Agenda
en production. Les tests locaux couvrent ces interruptions. Les compteurs
D1/R2/fournisseurs/Queue restent séparés dans les diagnostics; aucune mesure
de facturation distante n'est déduite de ce canary de cache.

La correction d'ETag paginé requiert le lecteur 1.0.39 pour les réponses v4
de plusieurs pages : le lecteur 1.0.38 compare encore leurs ETags entre eux.
La route reste v4 et le cache existant reste conservé, mais les anciennes
extensions doivent être mises à jour pour cette pagination. Vérifier cette
limite de compatibilité avant la promotion du Worker et ne pas annoncer une
certification des anciens clients sur plusieurs pages.

### Reprise Agenda après interruption

Le Worker corrigé conserve le travail sous `agenda-operations/v2/pending.json`
dans `tobirink-public-releases`; la lecture de repli et l'import checkpointé
des anciens signaux conservent tous les objets `agenda-operations/v1`.
Une lane `ready` doit être republiée dans D1, puis confirmée `published`.
Ne pas vider la Queue, supprimer un checkpoint, changer une date de session
ou remettre à zéro une tentative pour débloquer une publication.

La reprise contrôlée consiste à soumettre une seule enveloppe JSON
`{"type":"agenda-recovery","version":1}` à la Queue existante
`tobirink-public-discovery`, via une session Cloudflare authentifiée autorisée
à publier des messages. Vérifier le compte et cette ressource exacte avant
envoi; l'opération ne passe par aucune route HTTP publique TobiRink.
Attendre au moins une minute depuis une tentative d'envoi échouée, puis
observer le diagnostic `native-collector.queue` pour ce type et le traitement
`agenda-refresh` suivant. La reprise sélectionne elle-même la plus ancienne
session restante; elle ne réinitialise ni les essais Discovery ni les données.
En cas d'indisponibilité persistante, conserver les objets et attendre le
déclenchement hebdomadaire. Cette procédure n'est pas une nouvelle cadence.

Les diagnostics de collecte séparent `d1RowsRead`, `d1RowsWritten`,
`r2Reads`, `r2Writes`, `r2Lists`, `r2Conflicts`, `providerRequests` et `retries`.
La fixture locale de 579 événements annoncés mesure 446 lectures/34 écritures R2 à
la première collecte, puis 444/34 pour une collecte identique; cette dernière
ne produit aucune écriture métier D1. Ces nombres sont des mesures de fixture,
pas une estimation de facture ni une certification de production. Les annonces
ne produisent plus d'observations confirmées; les anciennes mesures 805/393
incluaient cette promotion incorrecte.

La candidate corrective ajoute `queueSends` (tentatives) et `queueFailures`,
ainsi que les événements `worker.cost` des tâches `agenda-admission` et
`agenda-recovery`. Additionner ces tâches à `agenda` et `discovery` pour le
coût du traitement complet; ne pas sommer un total de réveil supplémentaire.
La reprise est coalescée une fois par lot Queue, même avec plusieurs messages
opérationnels. Le scan legacy continue par lots de vingt, y compris si aucun
signal de sa première page ne reste à traiter.

Seuils opérateur : chaque `agenda-recovery-failed` et `retry-to-dlq` exige une
inspection; `agenda-recovery-overdue` signale une session de plus de huit jours.
Inspecter la Queue et sa DLQ, puis les pointeurs R2 sans les modifier. La
réservation d'envoi expire après une minute; une reprise contrôlée peut ensuite
réémettre le travail conservé. Sans aucun réveil Queue, le prochain cron
hebdomadaire est le seul secours automatique prévu; son échec exclut toute
garantie de délai maximal. Le raccordement de ces codes à une alerte externe
et l'inspection distante du backlog/DLQ restent à certifier séparément. Aucun
destinataire ni service d'alerte n'est créé par ces changements locaux.

Ordre de livraison de cette candidate : appliquer la migration additive 0026,
vérifier le singleton `catalogue_release_generation` et la conservation des
modèles, puis déployer le Worker compatible et effectuer les canaries avant
d'avancer le pointeur d'une nouvelle archive immuable. La migration initialise
son singleton depuis les modèles présents; aucun backfill massif n'est requis.
Rollback : restaurer le Worker précédent en conservant tables, index, triggers,
archives et snapshots. Les nouvelles ressources D1 sont ignorées par l'ancien
Worker. Ces opérations distantes demandent une approbation dédiée.

### Publication 1.0.38

Publication autonome autorisée le 19 septembre 2026. La version de repli
inspectée est `ee48b6be-752e-4e1e-a681-8ea0eb43a3dc` à 100 %, sans migration
D1 en attente. Le correctif `25bfc2e` adapte le timeout au temps restant et
limite la prélecture à cinquante sources pour éviter une famine d’admission.
`npm run verify` passe après passage à `1.0.38`; les archives reproductibles
sont installées et vérifiées hors ligne sur Chromium 153 et Firefox 155.
Chrome : 297370 octets, SHA-256
`b5f1943e54fff91d605b6e0d1df850a95865f548daf630d9152fbb45ff6589f3`.
Firefox : 297411 octets, SHA-256
`8ab230140d469d20b2ad5b8e45471e96ecbbf72a9908d4bd55c0233e57845b86`.
La gate `node scripts/infra/installed-discovery-canary.mjs <chrome.zip>`
installe le ZIP intact dans un profil temporaire, simule un MISS et retarde
la prélecture de six secondes. Seules les routes Discovery du Worker sont
autorisées; les réponses vérifiées restent réelles. Les favoris de test sont
publics et fixes. La gate attend les alarmes natives sans forcer la reprise.
Les deux archives ont été publiées via le plan
`44cb31c0ade93b0084c1fff348586d49aedb229b074807782dc3b7d6c9ade8a0`,
puis téléchargées publiquement avec les tailles et empreintes ci-dessus avant
avancement du pointeur vers `1.0.38`. Aucun secret, schéma, quota ou gateway
ne change.
La gate installée a réussi : deux POST du service worker, deux prélectures
ralenties, une admission `PENDING` et une admission déjà `VERIFIED`, puis deux
sources résolues après alarmes natives. Le lot Queue observé a accepté un
résultat avec un appel fournisseur, 44 lignes écrites et zéro retry.
Le premier essai utilisait deux favoris de la même œuvre : une seule admission
suivie de réutilisation locale était correcte. Les fixtures finales distinctes
vérifient séparément le titre Cowboy Bebop et la référence AniList 205.
Un garde-fou du harness rejetait initialement le titre de secours numérique
de l’URL fournisseur sans slug; il accepte désormais uniquement l’ID exact
attendu. Les demandes refusées par ce garde-fou n’ont pas été transmises.

Le Worker final est `a66e751f-6a83-4757-bff6-2778bfb361bf`, déployé via le plan
`723a2ee2231fecb9c30c320e01cf40e53c53420af81a27b1df9d77bab28bf997`.
Le premier plan Worker a été refusé pour changement d’état de l’inspection,
avant mutation; une nouvelle inspection et un nouveau plan ont permis la
publication. `/download` répond 200 et expose les deux liens `1.0.38` dont
les SHA-256 ont été revérifiés après déploiement.
La gate installée repasse contre ce déploiement : deux POST du service worker,
deux réponses VERIFIED et deux favoris résolus avec le même ZIP, après les
prélectures de six secondes et la reprise par alarme. Le Worker est actif
à 100 % et aucune migration D1 n’est en attente. La bibliothèque personnelle
reste distincte de cette preuve en profil temporaire.

### Publication 1.0.37

Autorisation utilisateur de fusion, push et déploiement reçue le 18 septembre.
La version de repli inspectée est `a80014e6-05b4-42f5-b682-1d51677b1048`
à 100 %, avec le pointeur `1.0.36` et aucune migration en attente.
Les archives publiées `1.0.37` sont reproductibles et leurs parcours
installés passent sur Chromium 153 et Firefox 155 (1 532 fixtures dont
1 400 médias, aucun résultat inventé hors ligne).
Chrome : 297360 octets, SHA-256
`eac0126c034a58b5b3a17ae3ded4d855f770949bc4912174523c300cce018142`.
Firefox : 297401 octets, SHA-256
`908018a490293d4bc24ab516922f8a6eec9cc64fd1e4d6c4b9277c16b9a6105d`.
La gate `node scripts/infra/recovery-1037-canary.mjs read|submit|observe` est bornée
aux deux fixtures publiques de cette version, par titre et référence exacte.
`read` utilise uniquement le lookup; `submit` admet deux demandes espacées
de sept secondes. Les sorties contiennent seulement état, statut et durée.
`observe` filtre pendant 55 secondes les compteurs de coût, sans contenu privé.
Le Worker correctif `a1b5e440-8703-468a-86d4-383c31898e37` a été déployé
avant publication des archives. Les deux canaries initialement `MISS` ont
atteint `VERIFIED`, avec vérification du titre et de la référence AniList 1.
Admissions serveur : 177/176 ms; lectures vérifiées : 29/33 ms.
Les deux lots fournisseur ont écrit 16/10 lignes, sans retry; les admissions
ont écrit 7 lignes chacune. Ces mesures bornées ne certifient pas la bibliothèque
personnelle. Le plan Worker appliqué porte le digest
`59385fc33cfde1197161930b103f1cc3391cdc8fd9649970beb553e7bec73ed8`.
Le plan R2 appliqué porte le digest
`6adeddad01fc48c98692f27c6c57ef03917eb77cf5319528dfd9b5968ee520db`.
Les deux ZIP téléchargés publiquement correspondent aux tailles et SHA-256
ci-dessus avant avancement du pointeur vers `1.0.37`.
Le déploiement final `ee48b6be-752e-4e1e-a681-8ea0eb43a3dc` publie ce
pointeur, via le plan
`45308dc106f81947b46cb8412ddd07860e56ff4009678ba12db0696b02f0eb7c`.
Après déploiement, `/download` répond 200 avec les deux liens `1.0.37`;
les ZIP conservent leurs empreintes et les deux canaries restent `VERIFIED`.

### Garde-fous de récupération des favoris du 18 septembre 2026

Le correctif local conserve les routes v3, le schéma D1, les secrets et les
quotas existants. Ressources du parcours publié : Worker
`tobirink-public-api`, D1 `tobirink-public`, Queue `tobirink-public-discovery`
et sa DLQ `tobirink-public-discovery-dlq`. Aucun changement de gateway n’est
prévu. L’admission reste limitée à 10/minute, le claim à 20 et la concurrence
Queue à 1; les continuations attendent 1–900 secondes et les appels extension
15 secondes maximum. Une admission répétée ne réarme jamais `FAILED`.

Pour toute nouvelle opération, réinspecter via la gate le déploiement actif et
matérialiser un plan frais limité aux ressources autorisées. La version de repli
confirmée pour cette publication est `a80014e6-05b4-42f5-b682-1d51677b1048`.
Aucun rollback de données ni migration
destructive n’accompagne le retour au code précédent.

Canary exécuté : deux demandes synthétiques seulement, une par titre et une
par référence exacte, plafond de 100 écritures D1 chacune et arrêt à la première
résolution sans preuve, au premier conflit ou à la première boucle de reprises.
Conserver les seuils journaliers 20 000/50 000 documentés ci-dessous. Mesurer
séparément admission < 500 ms et lecture D1 < 300 ms hors démarrage à froid;
le délai fournisseur reste observé, sans promesse immédiate. Inspecter les
tentatives, échéances, Queue/DLQ et résultats vérifiés avant l’extension.

Les ZIP locaux `1.0.36` servent uniquement aux tests et ne doivent pas écraser
une release immuable. Une publication nécessite une nouvelle version approuvée,
deux archives installées vérifiées et un pointeur publié cohérent. La preuve
finale sur les favoris personnels reste à produire après cette promotion,
avec seulement des compteurs agrégés avant/après.

Incident de validation locale : le premier harness Firefox utilisant seulement
Playwright `setOffline` a observé des états publics `PENDING`; des demandes
synthétiques ont donc pu atteindre le service. Ces profils sont fermés et
aucune donnée personnelle n’a été utilisée. Le harness corrigé impose un proxy
local fermé et vérifie le blocage avant création du corpus. Aucun nettoyage
serveur automatique n’est autorisé; une éventuelle inspection et remédiation
doit conserver les données et suivre la gate opérationnelle.

```sh
npm run infra:inspect -- --account <cloudflare-account-id>
```

Inspection is read-only. The Cloudflare driver checks the authenticated account,
current Worker deployment, pending D1 migrations, and configured R2 buckets.
Worker, database, and bucket names are read from `apps/worker/wrangler.jsonc`.

## Plan

Choose only the operations intended for the next change:

```sh
npm run infra:plan -- \
  --account <cloudflare-account-id> \
  --operation d1-migrate:PUBLIC_DB \
  --operation worker-deploy
```

Publishing the fixed extension candidates and the matching static Worker uses
only the version-derived operations exposed by the driver:

```sh
npm run infra:plan -- \
  --account <cloudflare-account-id> \
  --operation r2-publish:tobirink-chrome-mv3-1.0.0.zip \
  --operation r2-publish:tobirink-firefox-mv3-1.0.0.zip \
  --operation worker-deploy
```

The preview hashes the exact local bytes of both ZIPs and includes those hashes
in the plan digest. The driver cannot accept another bucket, object key, local
file, or version through command-line input.

Public agenda snapshots use the same bounded path. Place the strict snapshot at
`build/releases/<revision>.json` and its strict pointer at
`build/releases/current-<revision>.json`, then plan both matching operations:

```sh
npm run infra:plan -- \
  --account <cloudflare-account-id> \
  --operation r2-release-snapshot:<revision> \
  --operation r2-release-pointer:<revision>
```

The revision accepts only 1–64 ASCII letters, digits, dots, underscores, or
hyphens. The gate validates both JSON schemas, binds both hashes to the plan,
requires a matching pair, and always uploads the immutable snapshot before the
mutable `releases/current.json` pointer.

`plan` repeats inspection and runs `wrangler deploy --dry-run` when deployment
is selected. It prints a strict JSON plan to stdout; it does not write a plan
file or mutate Cloudflare. The plan contains only hashes of inspection and
preview output, its exact actions, its account, and a short expiry. Redirecting
that output to a reviewed file is an explicit operator choice outside the gate.

## Apply

Apply is a separately approved provider mutation. The operator must supply the
reviewed plan, its exact digest, its account, and every affected resource:

```sh
npm run infra:apply -- \
  --plan <reviewed-plan.json> \
  --approve <plan-sha256> \
  --account <cloudflare-account-id> \
  --allow d1:tobirink-public \
  --allow worker:tobirink-public-api
```

For the `1.0.0` publication plan, replace the D1 allowlist with exactly:

```text
r2:tobirink-public-releases/downloads/tobirink-chrome-mv3-1.0.0.zip
r2:tobirink-public-releases/downloads/tobirink-firefox-mv3-1.0.0.zip
worker:tobirink-public-api
```

For an agenda revision, allow exactly its two materialized R2 keys:

```text
r2:tobirink-public-releases/releases/snapshots/<revision>.json
r2:tobirink-public-releases/releases/current.json
```

Before the first mutation, the gate verifies the plan schema and digest,
freshness, account, resource allowlist, driver identity, current provider state,
and a repeated dry-run. Any mismatch fails closed. When both operations are
approved, D1 migrations run before release uploads, and the Worker deployment
runs last. No CI workflow calls `infra:apply`.

The approved orphan cleanup was bounded by the gate:

```sh
npm run infra:plan -- --account <cloudflare-account-id> \
  --operation d1-migrate:PUBLIC_DB \
  --operation queue-delete:tobirink-jobs-production
```

Its apply allowlist was exactly `d1:tobirink-public` and
`queue:tobirink-jobs-production`. Plan
`b3a217a0561d3174499527b46dc21732ebd565981b5c7ee1937c38e9b03bae38`
applied migration `0025` before deleting that Queue. The consumed retired
inventory is now empty; active queues remain rejected by the driver.

The Worker serves the static export through its `ASSETS` binding on
`tobirink.com/*`. Only declared member routes fall back to the export; API and
unknown paths keep their explicit JSON/404 behavior. Versioned downloads stream
from `tobirink-public-releases` with immutable caching, attachment disposition,
ETag, and content-type metadata.

The post-cleanup publication used plan
`74c982060b8ea554797494ca6aa682c59e62b75ab0e96309f5ac6b665019266d`,
whose only action was `worker:tobirink-public-api`. Worker version
`7d514091-35ff-496d-b533-e57d13fea3fd` then served the route and weekly cron.
Production probes returned HTTP 200 for the home page, `/download`, both
published `1.0.31` archives, `/v3/releases`, and `/v4/release-models`; the
download page contains only the provider-free `1.0.31` publication links.

The extension promotion used plan
`df8f2d8beaa37dd01095338998d3962de924bc30b3b875c27acfe109f33d715b`
for the two R2 objects, followed by Worker plan
`a63179af88b96eae46f3a57a56863f9a6209f283c0642f37c5f73cf1a7a0dbea`.
The final Worker version is `25589148-ce66-43ab-9634-ed6a6a635f10`; production
hashes match the local archives exactly.

## Emergency provider shutdown

The fail-closed emergency state is versioned in `apps/worker/wrangler.jsonc`:
`workers_dev` is false, `routes` is empty and `triggers.crons` is empty. Queue
delivery is paused separately because messages and bindings must remain intact.
Apply the barriers in this order from `apps/worker`:

```sh
npm exec -- wrangler queues pause-delivery tobirink-public-discovery
npm exec -- wrangler triggers deploy --dry-run
npm exec -- wrangler triggers deploy
```

Wrangler 4.129 does not send its route replacement request when `routes` is an
empty array. If the read-only Workers Scripts Routes inventory is still
non-empty, replace only this script's routes through the official account API:

```sh
curl --fail-with-body -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/<account-id>/workers/scripts/tobirink-public-api/routes" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '[]'
```

Never print or persist the token. The response and a subsequent GET must both
report an empty result before HTTP verification.

This intentionally removes the Worker-served site, API and downloads. It does
not deploy Worker code, run D1 migrations, purge Queue messages, or delete D1,
R2, Queue or Worker resources. Verify the Queue state, unchanged active Worker
version, absent Cron Trigger and the unavailability of both the custom route and
the `workers.dev` route before declaring the shutdown complete.

Rollback requires a separate approved provider operation. Restore the reviewed
route, `workers_dev` setting and cron in the versioned configuration; deploy
triggers and verify HTTP plus the scheduled inventory; then resume Queue
delivery last:

```sh
npm exec -- wrangler triggers deploy --dry-run
npm exec -- wrangler triggers deploy
npm exec -- wrangler queues resume-delivery tobirink-public-discovery
```

Never resume the Queue before routes and scheduling are known and the D1 cost
incident has been resolved.

## Native collector observability

### État déployé le 17 septembre 2026

La migration additive `0023`/`0024` et le Worker de compatibilité
`2e2e534b-7816-445c-992a-1576a7087ccd` sont déployés. L’inspection distante
confirme qu’aucune migration ne reste à appliquer. En cas d’incident, garder
les entrées scellées et privilégier un correctif en avant. L’export D1 frais
documenté dans [`d1-cost-audit.md`](./d1-cost-audit.md) fournit le point de
restauration ; son import écrasant exige une approbation destructive distincte.
Ne pas supprimer les tables, événements
legacy ou index tant que les deux générations de lecteurs et le premier cycle
hebdomadaire des modèles n’ont pas été vérifiés.

The authoritative recovery order, approval boundaries and local budget table
are in [the A-to-Z master plan](./tobirink-a-z-master-plan.md). The only active
operational entry point is `goal-controlled-d1-service-resumption`; historical
deployment goals must not start a parallel recovery.

Before any canary, approve explicit stop thresholds. The current proposal is a
warning at 20,000 D1 writes in one UTC day and a full reseal at 50,000; reseal
also when the first Agenda reconciliation exceeds 10,000 writes, a later Agenda
cycle exceeds 500, a fresh Discovery hit writes anything, a same-work/new-key
cycle exceeds 30, or a comparable first resolution exceeds 100. These are
operating guards derived from local references 55/19/70/76–77/1,798, not remote
measurements or Cloudflare billing guarantees.

After migration 0021 and a new Agenda publication, rolling back to the old
Worker can expose a stale legacy projection. Prefer keeping all entries sealed
and deploying a forward fix. Restoring the pre-migration backup is a separate,
destructive provider operation and requires exact approval.

Outside the emergency shutdown, Agenda is scheduled by Wrangler at
`23 3 * * SUN` (UTC). During the shutdown, `triggers.crons` remains empty.
Cloudflare cron changes can take up to fifteen minutes to propagate. Between
weekly triggers, no Agenda provider request is expected. The single Queue
message opens two independent D1 lanes; each lane owns one fifteen-minute lease,
a page checkpoint, `not_before`, and its last valid snapshot.

AniList is paced at one HTTP request every three seconds and MangaUpdates at
one every six seconds. Count quota consumption in HTTP requests, including
every pagination request. A `Retry-After` response becomes the per-message
Queue retry delay, capped at twenty-four hours. A partial provider failure must
leave its active snapshot and the currently served generation untouched while
allowing a changed successful lane to merge with that snapshot.

The semantic generation digest excludes collection timestamps and expirations.
Migration `0021_agenda_active_projection.sql` backfills the indexed
`public_release_current_event` projection and stores a bounded JSON rollback
snapshot on each retained generation. A changed merge mutates only added,
materially changed or removed active events in one D1 batch; an unchanged merge
advances `checked_at`. The active generation plus two rollback generations are
retained. Completed Agenda pages are retained only for each lane's active
snapshot or its current interrupted collection.

Apply migrations 0017 through 0021 before deploying code that reads the active
projection. Verify the two lane rows, active pointer, 579-row projection for the
reference fixture, three retained snapshots at most and the cursor query plan.
The first reconciliation is a separate write-budget event; do not combine it
with Queue or Cron reactivation. A migration, Worker deployment, Queue resume,
route restoration and Cron restoration are five separately observable phases.

Public Discovery uses migration `0018_discovery_admission_state.sql`. Only an
admission `created` sends the opaque Queue signal; `existing` returns the
cached or pending state without sending and `saturated` returns 503. The
consumer accepts twenty signals, waits at most five seconds to form a batch and
permits one concurrent consumer. It invokes one `claim(20)` and acknowledges
redundant signals. The D1 outbox moves through `UNSENT`, `SENDING`, then `SENT`. If an
initial Queue send fails, keep the PENDING row and return it to `UNSENT`; an
identical POST can reclaim that unconfirmed send without creating another row.

The same migration creates `public_discovery_provider_runtime`. Inspect only
provider, timestamps and counters; it contains no title or request payload.
AniList reservations are three seconds apart and MangaUpdates reservations six
seconds apart. Three consecutive failures open the default circuit for fifteen
minutes; `Retry-After` may extend it. A successful real request clears the
failure count. `NOT_FOUND` and `AMBIGUOUS` remain cache hits for seven days,
then read as MISS and become admissible once more. Apply migration 0018 before
deploying the batched consumer or its Worker code.

Apply additive migration `0019_discovery_refresh_state.sql` before enabling
the refresh endpoint. It backfills `next_refresh_at` for existing VERIFIED
rows and adds an orthogonal refresh state; the public `state` must remain
VERIFIED while refresh work is pending or processing. Inspect only counts and
states, never `result_json`. A healthy refresh moves `IDLE → PENDING →
PROCESSING → IDLE`, emits one Queue signal on the first transition, keeps
`request_json = {}`, and advances `next_refresh_at` by seven days. An unchanged
profile must not add a catalogue revision. A provider failure or non-VERIFIED
result must leave the previous profile readable.

Migration `0020_catalogue_work_relations.sql` is historical. Relation-aware
collection was retired before producing remote rows. After a fresh D1 export,
zero-row verification and consumer audit, migration
`0025_drop_catalogue_work_relations.sql` removes only that table and its owned
indexes. Exact references that identify the same work remain in the canonical
catalogue; no season, sequel, source or adaptation creates Discovery work.

The Queue consumer emits one bounded JSON record with
`type=native-collector.queue`, `messageType`, `attempt` and `disposition`.
Failures add only a classified code and the bounded retry delay; raw provider
responses, titles, identifiers and envelopes are never logged. Agenda codes
distinguish `agenda-anilist-unavailable`,
`agenda-mangaupdates-unavailable`, their combined form and the unknown-provider
fallback.

### Daily adaptive-refresh counters

Filter Worker logs on `type=worker.cost` and aggregate by UTC day. Sum only the
closed numeric fields below:

- `providerRequests` for every recognized supplier HTTP call, grouped by `provider`;
- `pagesRequested` only for Agenda pagination pages actually requested; Discovery reports zero;
- `d1Hits` and `d1Misses` for public cache effectiveness;
- `deduplicated` for admissions that emitted no Queue message;
- `generationsCreated` and `generationsAvoided` for Agenda publication;
- `rehydrations` for accepted weekly work refreshes;
- `d1RowsRead` and `d1RowsWritten`, sourced from `D1Result.meta` by Queue
  processing and by Discovery HTTP routes.

`providerRequests` and `pagesRequested` are independent counters: a provider
may issue more than one HTTP call for a page, and a Discovery event has no
pagination pages. The other allowed dimensions are `task`, `acceptedResults`,
`result`, `durationMs` and `retries`. Do not add titles, fingerprints, work or
provider IDs, request URLs, IP addresses, payloads, secrets or installation
identifiers to a dashboard or export. A regular lookup reports HIT/MISS but
performs zero D1 writes; no observability table exists.

Expected invariants are one Agenda session per week, zero Agenda provider call
between sessions, zero provider call on a fresh cache hit, zero Queue message
for `deduplicated`, at most one accepted rehydration per work and week, and at
most eight retries. Compare daily `d1RowsWritten` with the native Cloudflare D1
usage view before investigating a regression; never inspect `request_json` or
`result_json` for cost analysis.

### Local cost certification

The Miniflare D1 integration suite freezes two volume references after all
migrations are applied. Fifty simultaneous admissions for the same unknown
work converge to one request row and five aggregate `rows_written`; the other
49 admissions reuse it. One HTTP lookup containing fifty absent keys reports
357 `rows_read` and zero `rows_written`. Provider counters also count attempted
AniList and MangaUpdates calls when their responses are 429 or 5xx, while the
collector error exposed to logs remains a bounded provider/status code.

These are deterministic local regression budgets, not production usage. A
native Cloudflare cycle and the D1 dashboard reconciliation remain required
after controlled service resumption before using them for paid-plan sizing.

The baseline also records storage bytes with SQLite
`length(CAST(value AS BLOB))`. Its synthetic same-work alias creates two
identical VERIFIED profile copies totalling 678 bytes. A later counter change
leaves two distinct copies totalling 696 bytes, while the relational preferred
title, titles and reference strings total 15, 59 and
6 bytes. These values expose current duplication; they are not database-file
size, index bytes or billable writes. The metrics wrapper trusts only native
`D1Result.meta`: a 64,000-character returned payload with `rows_written=1`
still counts as one write.

### Remote measurement checkpoint — 2026-09-17

At `2026-09-17T10:12:08Z`, `wrangler d1 info PUBLIC_DB --json` reported a
rolling 24-hour window of 23,567 rows read, 5,753 rows written, 345 read
queries, 720 write queries and 1,257,472 bytes of database storage. The
deployed Worker remained version `bfd038ea-4596-49aa-9add-7de77af5056c` at
100%, with no pending D1 migration and one producer plus one consumer attached
to the primary Queue.

A controlled one-key MISS lookup observed through `wrangler tail` completed
with HTTP 200, 9 ms CPU time and 28 ms wall time. Its bounded `worker.cost`
event reported 64 D1 rows read, zero D1 rows written, zero provider requests
and no accepted result. No request key or response payload is retained in this
runbook.

Two controlled MISS lookups occurred between the first native snapshot and a
second snapshot at `2026-09-17T10:14:58Z`. The rolling native values then read
23,652 rows read, 5,753 rows written, 348 read queries and 720 write queries:
an observed delta of 85 rows read, zero rows written and three read queries.
This is not an exact per-request reconciliation. The native counters are a
moving 24-hour aggregate with ingestion delay, while the application event is
per invocation and only one of the two lookups was tailed. Certification must
therefore compare complete UTC intervals after analytics have settled; it must
not force equality between an instantaneous tail event and two rolling
snapshots.

`wrangler d1 insights` confirms retained query analytics rather than only live
tail output. The seven-day view still includes the retired materialized Agenda
path, including 166,476 rows written by per-event generation inserts. The
one-day view still contains pre-cutover Agenda cleanup, including 13,896 rows
written by one retained-generation deletion shape. These historical queries
must be separated from the corrected version's post-deployment interval before
the seven-day economic result is certified.

The bounded post-cutover query at `2026-09-17T10:16:28Z`, using
`wrangler d1 insights PUBLIC_DB --time-period 10h`, isolates the corrected
runtime from approximately 00:16 UTC. Across 25 query shapes and 32 executions,
it reports 4,753 rows read, **zero rows written** and 70.3341 ms cumulative D1
query time. This reconciles the apparent write activity in the wider views,
but ten hours with no scheduled weekly cycle is only an early canary. It does
not certify the seven-day interval or an Agenda collection.

### Final seven-day reconciliation procedure

The certification interval is fixed at
`2026-09-17T00:29:00Z..2026-09-24T00:29:00Z`. Do not replace it with a later
rolling seven-day window. Cloudflare retains D1 analytics for 31 days, so query
that exact UTC interval through the D1 Metrics dashboard or GraphQL Analytics
API. Use `wrangler d1 insights PUBLIC_DB --time-period 7d --limit 1000 --json`
only as a corroborating query when run at the interval boundary; its rolling
window is not an exact substitute when run later.

For the same fixed interval:

1. export only retained Workers Logs whose parsed message has
   `type=worker.cost`, then group by UTC date, `task`, `provider` and `result`;
2. sum `d1RowsRead`, `d1RowsWritten`, `providerRequests`, `pagesRequested`,
   `acceptedResults`, `retries` and `durationMs`, and count Agenda sessions;
3. obtain native D1 `rowsRead`, `rowsWritten`, read/write query counts,
   response bytes, query time and maximum storage bytes for the database;
4. list D1 insights by total writes and reads, retaining the normalized query
   shape, execution count and totals but no bound parameters or result data;
5. record Queue delivered/retried/failed counts, Worker invocations/CPU, R2
   Class A/Class B operations and provider request counts as separate units;
6. verify that version `bfd038ea-4596-49aa-9add-7de77af5056c` served the
   interval, the cron remained `23 3 * * SUN`, and the primary Queue retained
   exactly one producer and one consumer.

Native D1 totals cover every database caller. `worker.cost` covers instrumented
Discovery HTTP and Queue processing, but not ordinary Catalogue or Agenda
public reads, operator inspections, migrations or direct D1 diagnostics.
Therefore reconcile the difference with D1 query shapes and invocation counts;
do not require the two aggregates to be identical. Every native write absent
from `worker.cost` needs a named query shape and an authorized cause.

The interval passes only when it contains the Sunday Agenda attempt, no
unexpected provider call occurs between Agenda sessions, no retry loop exceeds
the configured bound, no unexplained D1 write remains, and the previous valid
Agenda remains readable after any failed lane. Record zero-change weeks as a
real measured outcome. Keep the step open if logs are missing, analytics have
not settled or the exact interval cannot be reconstructed.

`ack-success` confirms a completed message. `ack-invalid` confirms that an
untrusted malformed signal was discarded. `retry` remains recoverable.
`retry-to-dlq` means the ninth delivery has failed after eight configured
retries and the
platform will transfer an exhausted message to
`tobirink-public-discovery-dlq`. The DLQ has no consumer: inspect it promptly
from the Cloudflare Queue dashboard or Wrangler because Cloudflare retains an
unconsumed DLQ message for four days. Replaying or purging a DLQ is a separate
provider mutation and requires an exact approved target.

The Deno gateway health probe is `GET /healthz`. A configured instance returns
HTTP 200 with `{ "status": "healthy" }`; an instance missing its secret or KV
binding remains closed with HTTP 503 and `{ "error": "gateway-not-configured" }`.
The server starts before awaiting the Deno KV connection so platform warm-up
can probe health immediately. Only signed traffic awaits the lazy KV promise;
an unavailable binding fails that request closed with the same bounded 503.

## Gateway 401 diagnostics

The gateway is the authority for separating authentication layers:

- `401 {"error":"invalid-signature"}` means the HMAC signature was absent,
  malformed or invalid. The request did not reach a provider and the log event
  uses `auth_failure_layer=gateway`.
- `401 {"error":"anilist-auth-failed"}` means AniList returned upstream 401.
  The event uses `provider=anilist`, `upstream_status=401` and
  `auth_failure_layer=upstream`.

Every gateway event contains only the bounded fields
`gateway_request_id`, `provider`, `upstream_status`, `status`, `duration_ms`,
`auth_failure_layer` and `retries`. The response also exposes the opaque
`X-Tobirink-Gateway-Request-Id` for correlation. Do not log or export titles,
fingerprints, complete URLs, request or response bodies, tokens, or secrets.
Gateway retries are currently `0`; Queue retry count is authoritative in the
Worker `native-collector.queue` and `worker.cost` events.

AniList public catalogue data does not require OAuth. The gateway therefore
does not add an `Authorization` header to Discovery requests. A future private
AniList feature must be designed separately and keep its token in the Deno
secret store only; never add it to Worker bindings, `wrangler.jsonc`, bundles,
or logs.

For an incident, first correlate the Worker response's gateway request ID with
the Deno event, then inspect only the provider name, statuses, duration and
retry count. A gateway-layer 401 requires checking the Worker/gateway HMAC
configuration. An upstream-layer AniList 401 requires checking the upstream
availability and request policy; it does not justify copying the upstream body
into logs or returning an unverified Discovery result.

## Zero-downtime gateway key rotation

The Worker signs with `PROVIDER_GATEWAY_HMAC_KEY` only. Deno accepts that
current key and, during a rotation window, one distinct
`PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS`. Both values must contain 32–256 UTF-8
bytes. An empty, duplicate, weak, oversized or third key leaves the gateway
closed. The inspection gate records environment-variable names and secret
classification, never their values.
It accepts the Deno CLI legacy `name`/`secret` and current `key`/`isSecret`
inventory shapes, normalizes both to the same value-free record, and fails
closed on an ambiguous or unknown shape.

Rotate in this exact order, with a separately reviewed provider plan and exact
approval for every apply:

1. keep the old key only in the operator environment as the previous value and
   generate the new current value outside the repository;
2. apply one Deno plan containing `gateway-previous-secret-set`,
   `gateway-secret-update` and `gateway-deploy`; the driver installs the old
   previous key before changing the current key;
3. verify `/healthz` and a signed request from the still-old Worker;
4. apply the Cloudflare secret update and Worker deployment with the new
   current key, then verify Discovery and Agenda traffic;
5. apply a final Deno plan containing `gateway-previous-secret-delete` and
   `gateway-deploy`, then repeat the traffic check.

Never combine step 5 with the Cloudflare switch. Removing the previous key is
a destructive secret mutation and remains forbidden without approval for that
exact Deno variable. Roll back before step 5 by restoring the old Worker key;
after step 5, reinstall the old Deno current key first if rollback is required.

The Deno gate never places either HMAC value in process arguments. Secret-set
operations call `deno deploy env load` with one allowlisted variable stored in
a private temporary directory and a `0600` file, then remove that directory on
success or failure. A generic failure code replaces raw CLI errors so a
provider echo cannot disclose the value. Current-key updates use Deno's
`--replace` flag because the current secret already exists; the driver remains
the only place that supplies this flag. Do not replace this path with direct
`env add` or `env update-value` automation: both require the value in argv.

## Public Discovery retention

D1 records deletion eligibility without deleting data automatically:

- result nonces: seven days after ingestion;
- `FAILED` requests: thirty days after terminal failure;
- `NOT_FOUND` and `AMBIGUOUS`: fresh for seven days, then retained but read as
  expired until a new bounded admission replaces their result;
- terminal request payloads: replaced immediately by `{}` while their bounded
  result cache remains retained;
- catalogue revisions no longer referenced by a work: eligible after thirty
  days, determined at purge time.

A purge is a destructive provider operation. Before running one, export and
verify a D1 backup, inspect exact row counts, prepare bounded `DELETE`
statements for only the eligible rows, and obtain explicit approval for those
targets. The migration and runtime added here never execute those deletions.

## Replacing the provider

Keep the core unchanged. Implement another driver with the same `inspect`,
`preview`, and `apply` boundary, add it at the command composition root, and run
the shared negative contract suite. Provider SDKs and commands stay in that
driver; application use cases and HTTP routes do not change.
