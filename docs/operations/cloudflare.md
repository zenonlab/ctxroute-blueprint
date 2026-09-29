# Cloudflare operations gate

Tobirink does not expose Wrangler as a release command. Every provider change
starts from the repository-owned gate, while the extension and Worker runtime
remain independent of this operational path.

## Contrôle de restauration de la candidate 1.0.47

Conserver le dossier d'installation Chrome, remplacer son code sans
désinstallation, puis utiliser **Recharger** dans `chrome://extensions`.
Le manifeste seul ne prouve pas que le nouveau background s'exécute.
Vérifier les tables privées avant toute reprise après export/restauration,
puis contrôler la reconstruction locale et deux redémarrages. Un cache de
parsing absent ne doit pas invalider une source inchangée aux mêmes versions.

Comptabiliser les sources séparément des cartes Library : plusieurs sources
peuvent rejoindre une œuvre locale déjà présente. Les données publiques et
les décisions privées doivent être conservées, sans régression de progression.
Le contrôle hors ligne n'autorise aucune reprise D1 et ne certifie pas les
attentes réseau. La signature Firefox et les fichiers publics exacts restent
des preuves distinctes; aucun ZIP non signé ne remplace cette certification.

## Publication 1.0.45 — certifiée

Le run protégé `36295558091` a validé le SHA main
`07723a1a0025f1bf63066330bbf4188fd2c45f5c`, le Worker unique, les routes et
les probes avant de publier les deux archives. Les canaris frais anime et manga
ont chacun produit un appel fournisseur accepté : 183 et 195 lectures D1,
378 lectures et 34 écritures au total, sans 429, erreur réseau, retry ni échec
Queue. Aucune ligne `FAILED` historique n'a été réarmée.

Les objets ont été relus en HTTP 200 avant l'avancement séparé du pointeur Web :
Chrome 318507 octets, SHA-256
`c044bf1bfbb5af3c9ef79e7d8c41c2320f212fa75f37b925d17434ca7f29df1c`;
Firefox 318548 octets, SHA-256
`1de6845307a73a08c3f1d670364619f3a2787076c3831504f18d430e216cc949`.
Les objets 1.0.44 restent immuables et disponibles pour rollback.

## Incident Queue Discovery — contournement borné

Tant que le runtime Cloudflare Queue renvoie une erreur d'envoi non qualifiée,
`DISCOVERY_DELIVERY_MODE=worker-direct` traite une admission fraîche dans le
Worker. Le traitement réclame exactement sa clé et ne programme aucune
continuation Queue ; les crons et le consumer Queue restent inchangés. Ce mode
est réversible par retour à `queue` dans le même fichier Wrangler et ne
réarme jamais les lignes `FAILED` historiques.

## Publication 1.0.44 — certifiée

La source et le pointeur publié sont `1.0.44`. Le run protégé
`36253775721` a reproduit les archives, validé Playwright et la suite complète,
appliqué le Worker avec routes conservées, puis certifié deux canaris frais.
Anime et manga terminent VERIFIED avec chacun un appel fournisseur et un
résultat accepté; la campagne cumule 216 lectures et 34 écritures D1, sans
retry, 429, erreur HTTP/réseau ni échec Queue.

Le plan R2 séparé ne contenait que les ZIP Chrome et Firefox 1.0.44. Les deux
objets ont été relus en HTTP 200 avec cache immuable : Chrome 303214 octets,
SHA-256 `bc31da284a42a9d68dea420b00e68caed4310a8a8e8e6af46a7ceec601d3b7f2`;
Firefox 303256 octets, SHA-256
`6c1e218e564e9e9cecbab73b8627197203b93879bdd87633d21116dad28be4e3`.
Les objets 1.0.42 et 1.0.43 ne sont pas remplacés.

La [certification du 23 septembre](../audits/favorite-convergence-20260923.md)
sépare corrections, preuves locales, mesures de coût et validations distantes
restantes. Aucun canari de cache chaud ne suffit à prouver une nouvelle collecte.
Les sections datées ci-dessous sont des preuves historiques, pas une
description de la version actuellement active.

### Profil installé : barrière réseau

Le parcours installé crée toujours une session neuve pour une mesure réseau;
les sessions historiques antérieures au garde ne sont pas reprises. Avant de
charger l'extension, le runner exige dans l'archive les clés racine, le content
script, les permissions, l'unique `host_permissions` TobiRink et la directive
CSP native `connect-src https://tobirink.com`. Cette directive interdit
`ws:`/`wss:` jusque dans le service worker MV3. Le compteur `routeWebSocket` ne
vaut que tripwire de page. Playwright autorise ensuite seulement
`chrome-extension:` puis les
couples exacts de l'origine `https://tobirink.com` nécessaires aux lectures
Discovery/Agenda et aux routes `/requests` ou `/refreshes`. Toute origine
fournisseur, autre origine, méthode, chemin, paramètre, corps ou en-tête
inattendu ferme le contexte. Les valeurs Origin/User-Agent/Content-Type et
l'ETag Agenda optionnel sont elles aussi bornées.

Le budget mutationnel partagé vaut zéro par défaut et deux au maximum; le
budget refresh lui est inférieur ou égal. Les lectures en ligne possèdent leur
propre plafond explicite. Hors ligne, elles ne sortent pas : Discovery reçoit
un `MISS` local pour prouver une tentative d'admission, ensuite bloquée sans
`route.fetch`. Avant une vraie mutation, le runner écrit un reçu exclusif en
mode `0600`; les lectures réservent un slot privé et le premier échec écrit un
sceau privé, tous relus à la reprise. Le sceau mémoire est posé avant tout
`await route.abort` ou `await webSocket.close`, puis revérifié sous mutex et
juste avant I/O pour qu'une requête concurrente ne sorte pas après l'échec. Un reçu
incertain consomme le budget et ne doit jamais être rejoué. Redirections et
retries transport restent désactivés. Chromium doit ensuite se fermer sans
erreur et tous les handlers atteindre `inFlight=0`. Toute admission réelle
requiert une confirmation immédiate distincte et s'arrête sur 429, statut hors
contrat, erreur Queue ou réseau. Le runner ne réarme jamais automatiquement un
`FAILED` historique.

## Historique extension 1.0.42

Lors de cette livraison, la version source et le pointeur Web ont été alignés
sur `1.0.42`, sans modifier les archives `1.0.41`. La séquence locale était :

    npm ci --ignore-scripts
    npm run postinstall --workspace @tobirink/extension
    npm run build --workspace @tobirink/web
    npm run package:extension
    node scripts/release/package-extension.mjs --verify-isolated
    npm run setup:browser --workspace @tobirink/web
    npm run test:e2e --workspace @tobirink/web

Le manifeste ignoré sous `apps/extension/.output/packages/` est la preuve
locale des deux manifestes générés, tailles, nombres de fichiers et SHA-256.
La publication R2 est limitée aux deux ZIP `1.0.42`; le pointeur public ne
peut avancer qu'après comparaison des téléchargements distants et des hashes
acceptés. Aucune migration D1, suppression, rotation de secret ou permission
n'est incluse.

Le plan appliqué `772a71e296835afa9e8aeac3fd4197c723cec09d7de41e8798f97df35f79401b`
contenait exactement les deux uploads R2 1.0.42 et `worker:tobirink-public-api`
avec `preserveRoutes=true`. Le Worker publié est
`b25b2c41-081e-47ac-807c-f03d01eeab76`. Les deux URLs publiques répondent 200
avec `application/zip`, cache immutable et des SHA-256 identiques aux archives
locales; `/download` annonce uniquement 1.0.42. Les objets 1.0.41 ont été
relus et leurs hashes historiques sont inchangés.

## Livraison GitHub protégée

Le workflow `.github/workflows/deploy-production.yml` se déclenche sur `main`
ou par lancement manuel. Il s'exécute sur le runner auto-hébergé explicitement
labellisé `self-hosted`, `macOS`, `ARM64`, `cloudflare-ci`; il prépare Node 22
et Python 3.12 via `uv`, installe le lockfile, prépare les types générés de
l'extension, restaure le pin Archify, construit les manifests Chrome et Firefox,
exécute `npm run verify`, génère un plan expirant puis applique exactement la
cible `worker:tobirink-public-api`. Il ne migre pas D1 et ne modifie pas les
secrets; le déploiement conserve les réglages Queue du fichier Wrangler.
Aucun autre runner ne peut recevoir cette lane de production.

Un lancement manuel sur une branche conserve les vérifications et le plan en
lecture seule, mais n'applique aucun Worker et n'admet aucun canari. Ces étapes,
ainsi que les probes post-déploiement, exigent `refs/heads/main`. La publication
des archives conserve sa condition distincte sur `main` et ses deux options.

Le diagnostic agrégé reçoit explicitement `CLOUDFLARE_ACCOUNT_ID` et le token
depuis les secrets existants. Il refuse un compte absent ou invalide avant de
lancer Wrangler ; aucun élargissement de permission ni découverte automatique
de compte n'est requis. Les erreurs 9109 observées le 26 septembre concernaient
la lecture `/accounts`, pas une panne D1 prouvée. Un ID explicite ne garantit
pas les droits D1 : une lecture avec l'identité CI doit encore réussir.

Avant ces lectures, la CI vérifie le même jeton depuis le runner, d'abord par
`GET /accounts/{account_id}/tokens/verify`, puis par `GET /user/tokens/verify`
si nécessaire. Elle ne publie que le type compte/utilisateur et le statut actif,
ou deux codes fermés avec statuts HTTP et codes d'erreur numériques ;
l'identifiant du jeton, l'adresse IP et les messages Cloudflare restent masqués.
Ce prévol ne modifie ni jeton ni ressource.
Il sonde ensuite `GET /accounts/{account_id}/d1/database` avec le même jeton,
en limitant la réponse et sans publier l'inventaire ; seule la présence de la
base attendue ou un code de refus fermé est rapportée.

Chaque requête SELECT utilise directement le CLI Wrangler verrouillé dans
un processus enfant via l'exécutable Node courant, avec une limite de quinze secondes et de 1 Mio
de sortie. Le processus est tué à l'échéance ; aucun wrapper npm intermédiaire
n'est conservé. Les quatre requêtes ne sont pas réessayées et l'étape CI est
limitée à deux minutes. Les logs disque et rapports d'erreur Wrangler sont
désactivés. Le rapport ajoute seulement des échecs `{query, code}` issus d'une
liste fermée : compte absent/invalide, accès refusé, jeton refusé depuis la
localisation du runner, authentification générique, timeout,
sortie excessive, commande absente, transport, requête ou réponse invalide.
Ni stdout/stderr brut, ni token, ni corps privé ne quitte cette frontière.
Le code `token-location-denied` ne contient pas l'adresse IP ; il n'est émis
que si Wrangler fournit explicitement le motif de restriction de localisation.
Toute requête manquante garde `ok=false` et interdit le plan/application.

L'input `publish_extension` reste faux par défaut : les pushes ne publient
aucun objet R2. Un lancement manuel sur `main` doit aussi activer
`run_manga_canary`; le prévol refuse toute autre combinaison avant l'apply
Worker. Après les canaris réussis, la CI crée un plan frais distinct contenant
exactement les deux archives Chrome/Firefox de la version candidate. Elle
recalcule leurs SHA-256 et tailles face au manifeste local, valide les cibles
uniques puis applique seulement ces deux allowlists R2. Les secrets GitHub
existants sont réutilisés; une permission R2 absente bloque sans modification
automatique du token.

Les deux téléchargements publics doivent répondre 200 avec type ZIP et cache
immutable, correspondre aux tailles et SHA-256 locaux, sans redirection, sous
une deadline commune de trente secondes et 5 MiB par archive. Le workflow
ne modifie pas `apps/web/published-extension.json` : sa promotion demeure un
commit séparé après ces preuves. Une publication partielle échoue, conserve
l'objet immuable déjà créé et l'ancien pointeur. Recréer un plan permet la
reprise idempotente; aucun objet n'est supprimé. Désactiver l'option ou revenir
au workflow précédent constitue le rollback du mécanisme, pas des archives.

Créer dans l’environnement GitHub `production` les secrets
`CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID`. Le token doit être limité au
compte et aux opérations Worker nécessaires. Les pull requests ne déploient
pas.

L’application Deno Deploy installée sur `tristan-monticelli/Tobirink` doit être
liée à `tobirink-provider-gateway` avec le répertoire d’application
`apps/provider-gateway`. Le `deno.jsonc` versionné impose le runtime dynamique
et `src/index.ts`. Le déploiement Deno est déclenché par l’intégration GitHub;
le workflow Cloudflare ne contient donc aucun token Deno.

`PROVIDER_GATEWAY_HMAC_KEY` reste un secret runtime séparé, configuré côté
Worker et gateway. Ne jamais le copier dans GitHub, le dépôt ou un plan. Après
chaque livraison, exécuter les canaries et les vérifications HTTP prévues avant
toute promotion métier. En cas d’échec, arrêter le workflow et restaurer la
révision Deno ou la version Worker précédente; conserver D1, R2 et Queue.

## Inspect

### Publication corrective 1.0.41 — 19 septembre 2026

La version 1.0.41 contient le correctif du transport WebBridge et du tri de
la bibliothèque après redémarrage MV3. Les archives 1.0.40 restent des
candidates distinctes et ne sont pas remplacées. `npm run verify`, le build Web,
la validation Archify `dataflow` et deux builds isolés passent. Le packaging
normal reproduit les mêmes octets :

| Archive 1.0.41 | Octets | SHA-256 |
| --- | ---: | --- |
| Chrome MV3 | 299406 | `b651485195278f861b36f8f0ac19dd51ec9d58f6e0695afb9f46df0f0f53c456` |
| Firefox MV3 | 299447 | `adacd904d2e9fa3f4fa87fe7df75077894833be8e8f50aec880cb285e840dfe9` |

Le test Playwright installe le ZIP Chrome, peuple 1532 favoris synthétiques
dont 1400 médias, puis lit le site reconstruit. Le premier affichage prend
258 ms; quatre tris rendus prennent 70, 64, 59 et 72 ms. Après arrêt forcé du
service worker MV3, un autre tri apparaît en 181 ms. Ces chiffres portent sur
ce profil temporaire et cette machine, pas sur la bibliothèque personnelle.

La gate a appliqué la migration additive `0026_release_generation_revision.sql`
puis le Worker compatible sous le plan `389b2dae49a99c162296c4164aae9672556774b7cff3ff1737a1e4ce7ea9d22c`.
Le Worker intermédiaire `118069ee-f97a-4ad9-9b75-3f40523a7d1a` répond 200
sur les pages et les routes Agenda v3/v4; `/v4/release-models` lit le singleton
D1 sans erreur. L'inspection confirme qu'aucune migration ne reste en attente.

Le plan `ab7b1ebe00c21a1de97d748b1c70450194a12c21a3d88ec68d30b0e05459f83c`
a créé uniquement les deux objets R2 1.0.41. Les téléchargements publics
répondent 200, avec cache immuable et les SHA-256 exacts du tableau ci-dessus.
Après avancement du pointeur, le plan Worker
`02352a9f777996daf7befc7ed4f682a03f6a89b8caa0cb462357d48f3f563a04`
a publié la version `84d40f2e-6cd6-4c83-a33c-0a434ddc7861`.
Les cinq pages publiques répondent 200 et `/download` annonce les deux ZIP
1.0.41. Un profil Chromium temporaire, avec l'archive 1.0.41 installée contre
le vrai site, a affiché 1400 médias issus de 1532 favoris synthétiques :
premier affichage 473 ms, quatre tris rendus en 64, 61, 69 et 57 ms,
tri après arrêt forcé du worker en 136 ms. La bibliothèque personnelle reste
à mesurer sur son installation. Toutes les données et anciennes archives sont
conservées pour le rollback; aucun secret, quota, gateway ni Queue n'a changé.
Firefox 155.0 a installé le ZIP 1.0.41 au SHA-256 attendu : son corpus hors
ligne contient 1536 favoris observés, 1404 médias en reprise, 132 liens non
médias exclus et zéro tâche bloquée; les deux types de dates Agenda sont
reconstruits. L'inspection finale confirme le Worker `84d40f2e` à 100 % et
aucune migration D1 restante.

### Candidate locale corrective 1.0.40 — non publiée

Le 19 septembre 2026, `npm run verify` passe intégralement : Worker 139/139,
application 405/405, extension 152/152, Public Discovery 68/68, contrats 14/14.
Les validations Archify `all` et `public-discovery.dataflow`, les documents et
les ADR passent; l'audit npm rapporte zéro vulnérabilité. Le contrôle des hooks
ne relève aucune modification d'AGENTS, CLAUDE ou des hooks; la configuration
Codex personnelle reste exclue des commits.

Deux builds isolés puis le packaging normal produisent les mêmes archives :

| Archive 1.0.40 | Octets | SHA-256 |
| --- | ---: | --- |
| Chrome MV3 | 299328 | `d8597bacfbf0a218aa7569b17cbe04576c9188fff4b38e40b0146be4c9af160c` |
| Firefox MV3 | 299370 | `50d1ed5370b3d492c678907ec28d63eeed163d0241a1f3cb83fe56ed754eea6c` |

Chromium 153.0.8010.12 installe l'archive, reçoit une v4 non initialisée puis
l'historique v3 synthétique et affiche les sorties INSTANT/DATE après
rechargement hors ligne. Un autre profil conserve son identifiant d'extension,
1532 sources et 1400 médias pendant la mise à jour 1.0.39 vers 1.0.40 : zéro
résolution inventée, zéro tâche bloquée et 132 liens non médias exclus.
Firefox 155.0 installe son ZIP, reconstruit les deux types de dates hors ligne
et traite les 1532 fixtures plus quatre favoris initiaux : 1536 observés,
1404 retryables hors ligne, 132 exclus, zéro résolution et zéro blocage.

Commandes de reproduction, exécutées depuis la racine :

```bash
npm run verify
npm run archify:validate -- public-discovery.dataflow
npm run package:extension -- --verify-isolated
npm run package:extension
node apps/extension/scripts/installed-agenda.mjs apps/extension/.output/packages/tobirink-chrome-mv3-1.0.40.zip
node apps/extension/scripts/installed-review.mjs apps/extension/.output/packages/tobirink-chrome-mv3-1.0.40.zip apps/extension/.output/packages/tobirink-chrome-mv3-1.0.39.zip
FIREFOX_BIN="$HOME/Library/Caches/ms-playwright/firefox-1543/firefox/Nightly.app/Contents/MacOS/firefox" node apps/extension/scripts/installed-firefox.mjs apps/extension/.output/packages/tobirink-firefox-mv3-1.0.40.zip
```

Le dernier chemin doit désigner un Firefox de test déjà installé. Les profils
sont temporaires et les réponses réseau Agenda sont synthétiques. Aucun canary
de nouvelle collecte distante, déploiement, migration distante, publication
d'archive ou push n'est exécuté dans cette correction. Le pointeur public reste
1.0.39. La livraison doit suivre l'ordre 0026 → Worker → canaries → archives
décrit ci-dessous, avec approbation opérationnelle séparée. Les limites de
MangaUpdates pour les annulations, du coût v3 historique, de l'alerte externe
et de la certification personnelle restent dans l'audit d'automatisation.

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
prévu. L’admission reste limitée à 10/minute. La configuration actuellement
déployée conserve un claim à 20 et une concurrence Queue à 1; les continuations
attendent 1–900 secondes et les appels extension
15 secondes maximum. Une admission répétée ne réarme jamais `FAILED`.

La cible locale de remédiation réduit le claim à 5, attend jusqu’à 10 secondes
pour former le lot et autorise 2 consumers. Elle est versionnée dans
`apps/worker/wrangler.jsonc` mais nécessite encore le flux CI protégé avant de
devenir la configuration active.

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

L’inspection scellée conserve l’identité Cloudflare, les migrations D1, les
Queues actives et les objets R2 concernés. Elle exclut volontairement
`wrangler deployments status` : le dry-run Worker peut lui-même faire évoluer
cette métadonnée volatile entre plan et apply. Le fingerprint déterministe des
sources/config/assets et l’aperçu sont toujours recalculés avant mutation ; un
changement de code, de migration, de Queue, d’objet ou de compte reste bloquant.

La livraison GitHub de production ajoute `--preserve-routes true` au plan.
Cette option est incluse dans son digest et fait utiliser à Wrangler une copie
éphémère de `wrangler.jsonc` sans `routes`; le Worker, ses bindings, ses
queues et ses cron sont publiés sans réécrire `tobirink.com/*`. L’option n’est
pas implicite pour les plans locaux.

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
and a repeated dry-run. Wrangler's volatile dry-run text is excluded from the
digest; the Worker source, checked-in config and generated static assets are
fingerprinted instead, with only the generated Next build identifier
normalized. Any other mismatch fails closed. When both operations are
approved, D1 migrations run before release uploads, and the Worker deployment
runs last. The protected production workflow calls `infra:apply` only for its
Worker plan or the separately selected two-object extension publication plan.
Direct provider mutations outside that declared workflow retain the immediate
confirmation boundary in `AGENTS.md`.

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

All Worker and gateway provider requests carry the stable product
`User-Agent: TobiRink/1.0 (+https://tobirink.com)`; this is required for
MangaDex and keeps the upstream request identifiable without forwarding user
data. AniList is paced at one HTTP request every three seconds and MangaUpdates at
one every six seconds. Count quota consumption in HTTP requests, including
every pagination request. A `Retry-After` response becomes the per-message
Queue retry delay, capped at twenty-four hours. Discovery search errors
classified as transient (403, 404, 429, 5xx, timeouts or incomplete pages)
advance to the next provider in the same media lane; only when every
applicable provider fails does the request return to `PENDING`. An `UNKNOWN`
request waits for both media lanes and never publishes one lane while the other
is unavailable. A partial provider failure must leave its active snapshot and
the currently served generation untouched while allowing a changed successful
lane to merge with that snapshot.

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
currently deployed consumer accepts twenty signals, waits at most five seconds
to form a batch and permits one concurrent consumer. The remediated target
accepts five signals, waits at most ten seconds and permits two concurrent
consumers. It invokes one `claim(5)` in the target code and acknowledges
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
## Contrôle final de livraison

La livraison autonome standard vérifie après l’apply Cloudflare :

- `https://tobirink.com/` → HTTP 200 ;
- `https://tobirink.com/library` → HTTP 200 ;
- `https://tobirink-provider-gateway.tobirink.deno.net/healthz` → HTTP 200.

Le contrôle ne journalise pas les corps de réponse. Il affiche seulement le
statut et, lorsqu’il existe, l’identifiant de requête/corrélation fourni par les
en-têtes. La gateway Deno est déployée par son application GitHub App existante
sur `main`; aucun token Deno n’est ajouté au workflow Cloudflare.

Les mutations D1, R2, Queues et les rotations de `PROVIDER_GATEWAY_HMAC_KEY`
restent hors de cette livraison et exigent chacune leur propre plan, allowlist,
validation et preuve. Elles ne doivent pas être ajoutées au job standard pour
contourner cette séparation.

## Reprise Discovery après épuisement artificiel des tentatives — 2026-09-20

Le snapshot distant en lecture seule compte 476 demandes v3 : 88 `VERIFIED`
(83 anime, 5 manga), 333 `FAILED/ATTEMPT_LIMIT`, 38 `PROCESSING`, 14
`NOT_FOUND` et 3 `AMBIGUOUS`. Les 333 échecs comprennent 2 anime, 182 manga,
2 manhua, 33 manhwa et 114 médias inconnus. Les logs Queue montrent des lots
`acceptedResults=0`, `providerRequests=0` : une réservation de cadence trop
éloignée consommait quand même les essais pris au claim. La correction
versionnée diffère ces claims sans consommer d’essai et ne transforme ni `403`,
ni timeout, ni fournisseur indisponible en `NOT_FOUND`.

Une relecture distante effectuée le 20 septembre après ce snapshot confirme
toujours 476 demandes, sans écriture (`changes=0`, `rows_written=0`) : 371
`FAILED`, 88 `VERIFIED`, 14 `NOT_FOUND` et 3 `AMBIGUOUS`, sans ligne
`PROCESSING`. Cette différence d’état est observée seulement ; elle ne vaut
pas autorisation de réarmer les échecs.

Avant tout changement de production, conserver l’export D1 complet du
20 septembre sous `build/backups/tobirink-public-pre-discovery-cadence-20260920.sql`
(ignoré par Git, SHA-256
`6ff390845441f79ac59f4cef18509d5ea0be9a03e0d96a43caac61c983b1f4b2`,
2 019 796 octets). Son chargement complet dans SQLite en mémoire réussit.
Un nouvel export et son hash sont nécessaires si la reprise est décalée ou si
les comptes changent matériellement. Ne jamais copier le SQL, les titres, les
digests de demande ou une URL d'export signée dans les logs ou artefacts CI.

Le 21 septembre, un nouvel export complet a été conservé sous
`build/backups/tobirink-public-pre-recovery-20260921.sql` (ignoré par Git,
2 018 543 octets, SHA-256
`34cf362b446d7993a68795eefe7f48093b69cf2ce0c8b0c43d7e1533d652db3e`).
Son chargement SQLite en mémoire et `PRAGMA integrity_check` passent. Les états
restent 371 `FAILED`, 88 `VERIFIED`, 14 `NOT_FOUND`, 3 `AMBIGUOUS`.
Le test navigateur de l'archive Chrome publique 1.0.42 (SHA-256
`54f7a3d57c752e909d7c342a15951ac96c84619bac497cc4575f0c2c140b674a`)
obtient `200 MISS` depuis le service worker sur une clé synthétique. Un favori
synthétique déclenche une admission que le test intercepte et simule : aucune
demande n'est créée dans D1. Ce contrôle prouve la frontière réseau actuelle,
pas la disponibilité des fournisseurs ni la récupération des favoris privés.

La séquence de reprise est distincte de la livraison habituelle :

1. Publier seulement le code Worker validé depuis `main` par le workflow
   protégé `deploy-production.yml`, avec plan digesté
   `worker:tobirink-public-api` et `preserveRoutes=true`. Ce plan n'autorise
   aucune migration, remise à zéro D1, mutation R2 ou changement Queue.
   Le plan local du 20 septembre s'est arrêté en lecture sur
   `d1 migrations list` avec `Authentication error [10000]` : ne pas élargir
   le jeton local pour le contourner. Générer et vérifier le digest dans la
   gate CI existante avec ses credentials bornés.
2. Vérifier `/`, `/library`, `/download` et la gateway `/healthz`, puis
   confirmer dans les logs bornés que les reports de cadence réservent zéro
   requête fournisseur et ne créent plus de nouveau `FAILED` sans appel HTTP.
   Contrôler séparément les erreurs réelles MangaUpdates et MangaDex : leur
   accès depuis cette machine ne prouve pas l'accès depuis Worker/gateway.
3. Après accord immédiat pour chaque mutation hors CI, lancer deux demandes
   canari publiques et identifiées à l'avance, une anime via AniList et une
   manga via la lane MangaUpdates puis, si elle répond réellement sans
   correspondance, MangaDex. Observer les réponses fournisseur, le passage
   `PENDING → VERIFIED` et l'écriture canonique D1. Ne pas conclure au succès
   d'un simple HTTP 200, d'une réponse `PENDING` ou du healthcheck gateway.
   Préflight du 21 septembre, sans écriture : les clés v3 fixes ci-dessous
   répondent toutes deux `200 MISS` et leurs payloads passent le schéma local.
   La première utilise `ANIME`, l'empreinte `b` répétée 64 fois et les titres
   publics `Cowboy Bebop`; la seconde utilise `MANGA`, l'empreinte `c` répétée
   64 fois et les titres publics `One Piece`. Les deux portent
   `parserVersion=recovery-canary-20260921`, `siteRulesVersion=canary-v1` et
   `schemaVersion=3`, sans URL, dossier ou progression. Après confirmation,
   soumettre au plus un POST `/v3/catalogue/discoveries/requests` par clé,
   espacés d'au moins sept secondes; arrêter sur HTTP non-202, `429`, échec
   Queue, absence d'appel fournisseur vérifiable ou perte d'un profil servi.
   Lire ensuite ces seules clés jusqu'à un résultat terminal ou dix minutes,
   sans resoumettre et sans réarmer les 371 échecs. Les éventuelles lignes
   canari restent dans D1; leur suppression n'est pas un rollback automatique.
   Le canari du 21 septembre a confirmé `Cowboy Bebop → VERIFIED` via AniList.
   `One Piece` a rencontré une panne MangaUpdates et a ensuite atteint
   `ATTEMPT_LIMIT`. Le workflow protégé expose maintenant l'input manuel
   `run_manga_canary`; lorsqu'il vaut `true`, il soumet uniquement le digest
   exact de cette clé, observe au plus quarante lectures espacées de quinze
   secondes et exige `VERIFIED` avec une identité manga. Un push automatique ne
   l'exécute jamais. Un état terminal négatif ou une réponse non-202 arrête le
   job et ne réarme aucune autre ligne.
4. Préparer un plan de réarmement séparé pour les seules lignes
   `FAILED/ATTEMPT_LIMIT` issues de cet incident, avec comptes par média,
   clauses conditionnelles sur l'état et le digest courants, lots bornés,
   signal Queue opaque et contrôle après chaque lot. Les 38 baux en cours,
   les 88 profils vérifiés et les résultats terminaux ne sont pas remis à zéro.
   Le POST v3 réarme atomiquement une ligne `FAILED` seulement lorsque le
   payload validé reproduit la même clé et le même digest calculé côté
   serveur. La reprise passe exclusivement par cette admission publique ;
   aucun SQL manuel n'est autorisé.

Arrêter la reprise si un canari échoue, si une demande nouvelle ou réarmée
passe à `FAILED` sans appel fournisseur, si une publication perd un ancien `VERIFIED`, si la gateway
répond autrement que 200 au healthcheck, ou si le budget D1/Queue dépasse le
plan. Conserver les profils existants et les archives 1.0.41/1.0.42. Le
rollback du seul code Worker repasse par un plan de déploiement revu; une
restauration D1 est une opération séparée et non automatique.
## Reprise Discovery bornée

La limite d’admission publique est de 60 requêtes par minute et par IP ; l’extension attend au moins 1,1 seconde entre deux soumissions et respecte `Retry-After`. Le consumer Queue traite un message et réclame une demande par invocation, avec une seule invocation concurrente. Un second cron Worker, quotidien, réveille ce traitement borné pour les demandes D1 arrivées à échéance lorsqu’un signal Queue a disparu ; le cron Agenda hebdomadaire reste séparé et inchangé. Toute publication ou reprise D1 historique exige les canaris et la confirmation immédiate prévue par la procédure de production.

### Diagnostic et correction candidate du 24 septembre 2026

Avant correction, `wrangler d1 insights PUBLIC_DB --time-period 1h` mesurait
408 expirations de refresh pour 370 056 lectures, 334 claims pour 311 594
lectures et 292 expirations de demandes pour 272 750 lectures. Le plan distant
de `UPDATE ... WHERE rowid IN (SELECT ...)` scannait la table externe entière,
malgré l’index de la sous-requête. Un prédicat externe redondant sur les états
actifs permet au moteur d’utiliser les index partiels sans changer la sélection
ni ajouter de migration. Sur D1 local avec 500 échecs terminaux synthétiques,
un claim lit 25 lignes et un claim à vide 22, avec respectivement 3 et 0
écritures. Ce résultat local doit être corroboré après déploiement.

Les diagnostics Worker agrégés de 18:45 à 19:05 UTC comptaient 153 invocations
`success`, zéro erreur de plateforme, 40 `backoff`, un `failed`, 193 appels
fournisseur et aucun résultat accepté. `kitsu-manga` avait dix échecs
consécutifs et un circuit ouvert ; la DLQ contenait treize messages. Les
avertissements `provider-unavailable` masquaient la cause précise. La candidate
émet des codes bornés pour cadence, recherche incomplète, HTTP, réseau et
réponse invalide, sans titre ou payload privé. Aucun réarmement historique,
rejeu DLQ ni publication d’archive ne fait partie de cette correction Worker.

Le déploiement protégé de la PR #88 (run `36052050878`) a confirmé la baisse
des lectures D1 : le nouveau claim lit en moyenne 20 lignes contre 914 pour
l'ancienne forme, les expirations 19 contre 913 et 4 contre 907. Il n'a pas
rétabli les fournisseurs : `kitsu-manga` est passé à 16 échecs consécutifs et
son circuit s'est rouvert. Un GET public avec un titre de test non privé et
les champs clairsemés de l'adaptateur a retourné HTTP 200 avec
`titles.en: null`. Le schéma Worker exigeait une chaîne non vide pour chaque
traduction et rejetait donc toute cette réponse. Le correctif accepte `null`
comme traduction absente, garde le titre canonique et les alias valides et
refuse toujours les valeurs non nulles malformées. Il ne réarme aucune demande
historique et ne publie aucune archive ; les autres causes de backoff restent
à vérifier après déploiement.

La PR #89 (run protégé `36056110741`) a livré le schéma Kitsu corrigé, mais
la tentative automatique suivante a porté `kitsu-manga` à 18 échecs sans
résultat accepté ; 438 demandes `VERIFIED` et 367 œuvres sont conservées.
Le diagnostic Worker ajouté émet au plus un avertissement par fournisseur et
demande pour une erreur de réponse, un délai ou une erreur non classée. Il
contient uniquement le fournisseur et l'opération prédéfinis, plus un code
borné. Pour Zod, seul un nom de champ sur liste fermée est conservé ; un
chemin inconnu reste `provider-response-invalid`. Aucune valeur, titre, URL
ou réponse brute n'est journalisée. Ce changement n'effectue ni reprise D1,
ni canari, ni publication R2 ; les futurs codes doivent être observés avant
de décider d'un nouveau correctif fournisseur.

Après le déploiement de la PR #90 (Worker `b6d79552`), la tentative automatique
du 24 septembre à 21:26:19 UTC a révélé un rejet Kitsu manga sur `titles` ;
Kitsu anime rejette aussi `abbreviatedTitles`. Des GET publics bornés, sans
titre privé, montrent une traduction manga vide et vingt abréviations anime
valides. Le correctif ciblé ignore la traduction vide, utilise le titre
canonique comme repli d'affichage et accepte au plus 64 abréviations brutes
en conservant au plus seize titres et variantes. Un alias numérique ou plus
de 64 abréviations restent rejetés. Les autres rejets fournisseurs devront
être diagnostiqués séparément avant toute reprise historique ou publication.

La PR #91 (run `36062360487`) a livré le correctif d'alias. Les compteurs
d'échecs Kitsu anime et manga sont ensuite revenus à zéro, mais Discovery
observait encore des backoffs sans résultat accepté. Le diagnostic Worker
conserve désormais seulement un champ et une catégorie Zod sur listes
fermées, sans chemin complet, titre ou valeur fautive. Les schémas des
fournisseurs ne changent pas dans cette étape ; les codes servent à choisir
un correctif démontré plutôt qu'à assouplir les trois parseurs à l'aveugle.

Le contrôle du 25 septembre reproduit sur une recherche publique MangaDex
`One Piece` une réponse de 84 relations, rejetée par la borne locale de 64.
Le correctif candidat accepte au plus 128 relations sans élargir les vingt
résultats de recherche ni la réponse HTTP de 512 Kio. Il accepte au plus 256
abréviations Kitsu brutes mais projette toujours seize titres et variantes.
Un rejet de schéma sur champ inconnu ne journalise que la borne numérique
publique (au plus 1024), sans chemin, titre ni valeur. Le champ exact du rejet
MangaUpdates reste à établir après déploiement protégé ; aucun réarmement
historique ni publication d'extension ne découle de ce correctif.

Après la PR #93 et son run protégé `36069337874`, les recherches MangaDex et
MangaUpdates signalent toutes deux `unknown/too_big/max200`. La limite de
200 caractères appartient au candidat public, pas au corps HTTP fournisseur.
Une réponse contenant une autre identité au titre plus long ne doit plus
rejeter la preuve exacte de la page entière. Le correctif suivant projette
uniquement les titres de longueur contractuelle ; si un titre trop long est
écarté, ou si un alias dépasse la projection bornée, la page reste
explicitement incomplète et ne peut produire un
`NOT_FOUND` certain. Une hydratation exacte sans aucun titre projetable reste
un échec, jamais une identité inventée. Le plafond HTTP de 512 Kio demeure.

Le préflight du 25 septembre pour le prochain lot canari, en lecture seule,
trouve zéro titre et zéro référence D1 pour `Odd Taxi`/AniList `128547` et
`Spirit Circle`/MangaUpdates `13893304082`. Les quatre opérations publiques
`search`/`hydrate` réussissent localement sur ces identités. La gate canari
exige pour chaque clé un `MISS`, un seul POST, `PENDING`, puis `VERIFIED` avec
la référence exacte ; chaque fenêtre doit mesurer au moins un appel
fournisseur, zéro 429 et zéro échec Queue. Les seules sorties sont des états
et des compteurs agrégés, sans titre, empreinte ni corps fournisseur.
Avant la première admission, une lecture `MISS` aléatoire et sans écriture est
répétée jusqu'à ce que son coût apparaisse dans `wrangler tail`, au plus trente
secondes. Après chaque `VERIFIED`, la seconde admission reste bloquée jusqu'à
soixante secondes pour attribuer le coût fournisseur tardif à la bonne œuvre.
L'observation du trafic seule ne relie pas cryptographiquement un appel à
une clé ; l'absence préalable des titres/références et l'identité exacte
servent de preuves indépendantes. Ne pas publier l'extension ni réarmer les
`FAILED` par ce lot.

Le run du 25 septembre a ensuite mesuré 1 194 et 1 206 lectures D1 dans les
deux tâches `discovery`, malgré leur résultat `VERIFIED`. L'audit a isolé une
garde de conflit orientée depuis les 540 références existantes : 1 079 lignes
lues, contre deux lorsque la collection proposée bornée pilote le lookup par
clé primaire. Les sept écritures atomiques utilisent cette seconde forme sans
migration. Avant toute reprise historique, deux nouvelles clés doivent chacune
rester à au plus 300 lectures dans leur événement `task=discovery`, avec un
appel fournisseur, un résultat accepté, zéro 429 et zéro échec Queue.

Un consumer `public-discovery-ready` ne doit jamais se réessayer uniquement
parce que son signal de continuation n'a pas pu être ajouté à la même Queue.
Dans ce cas, il acquitte le message déjà traité, journalise seulement le code
`public-discovery-continuation-unsent`, et laisse le réveil quotidien borné
reprendre les lignes D1 encore dues. Cette dégradation conserve la Queue
`batch_size=1` / `max_concurrency=1`, évite une boucle de retries et ne réarme
aucune demande historique.

Un échec d'émission du signal initial d'admission journalise un unique événement
`native-collector.health` avec l'un des codes fermés `public-discovery-queue-binding-missing`,
`public-discovery-queue-rate-limited`, `public-discovery-queue-forbidden`,
`public-discovery-queue-unavailable` ou `public-discovery-queue-runtime-failed`.
Le diagnostic ne contient ni titre, empreinte, URL, corps de demande ni message
d'exception. En cas de rejet runtime, il peut seulement qualifier le type fermé
`type-error`, `dom-exception`, `error` ou `other-error`, et le détail fermé
`internal-error`, `message-rejected` ou `unknown`. Ce dernier est dérivé d'une
allowlist de phrases plateforme : toute autre phrase est masquée. Il rend le `503`
opérable sans élargir les données collectées.
Le signal d'admission utilise le format JSON par défaut du runtime compatible,
sans option `contentType` explicite. Son objet opaque contient `type`, `version`,
un UUID de corrélation non privé et un jeton de sélection aléatoire de 256 bits.
Il ne contient jamais la clé Discovery, l'empreinte, le titre, l'URL ou le
payload. D1 ne conserve que le SHA-256 du jeton; le consumer réclame uniquement
la ligne portant ce digest et remplace ensuite le claim par son propre jeton.
Ne jamais imprimer, exporter ou inclure le jeton brut dans un diagnostic.
Si le runtime Queue rejette ce signal, le Worker conserve l'admission et attend
un unique traitement borné pour cette clé exacte avant de répondre `202`; il ne réclame
ni ne réarme une ancienne demande `PENDING` ou `FAILED`. La réclamation D1
reste limitée à une demande et la Queue demeure la voie normale. Un échec du
repli, un claim absent, un report différé ou non publié répond `503` sans exposer
de détail ; la reprise cron existante conserve la récupération différée.
Après un envoi Queue réussi, une confirmation D1 défaillante émet séparément
`public-discovery-queue-confirm-failed` et conserve l'admission `202` : le
message opaque est déjà durable et ne doit pas être annulé ni redoublé.
Une continuation différée conserve le même UUID de corrélation uniquement si
le claim exact reste actif. Un réveil générique ou un claim vide ne porte aucun
UUID de certificat, afin qu'un autre travail ne puisse jamais être attribué au
canari observé.

### Qualification du budget d'essais fournisseur

Le résolveur portable conserve les erreurs ordinaires de transport, HTTP hors
429 et validation, plutôt que de les convertir en reports de cadence. Si
aucun fallback ne réussit, ces erreurs consomment la tentative D1 déjà prise.
Le bail existant, de quinze minutes, borne la prochaine prise ; huit échecs
consommants puis l'expiration du dernier bail donnent `FAILED/ATTEMPT_LIMIT`,
jamais un `NOT_FOUND` fabriqué. Les lectures restent sans réarmement implicite.

Une cadence ou un 429 rencontré après une erreur consommante ne peut effacer
sa dépense, y compris entre lanes `UNKNOWN` ou pendant l'hydratation de repli.
Un fallback réussi reste autorisé. Si seules des erreurs typées de cadence/429
subsistent, la tentative est restituée et l'échéance la plus tardive est gardée.
Dans un scénario mixte, le gate D1 du fournisseur conserve son `Retry-After`
même si le bail de la demande expire auparavant. Le profil déjà `VERIFIED`
reste servi pendant un refresh défaillant.

La configuration courante est `worker-direct` : un traitement HTTP direct
et le chemin Queue partagent ce résolveur, mais la concurrence Queue 1/1
ne sérialise pas les requêtes HTTP. Le schéma de reprise distingue désormais
ces deux entrées. Il décrit les conditions requises avant une reprise, pas
un certificat déjà obtenu par le script canari agrégé.

Ce correctif ne modifie ni la deadline Worker de trente secondes, encore
remboursable, ni les baux fournisseur sans propriétaire, ni l'absence de
checkpoint de pagination. Il ne prouve donc pas une convergence universelle.
Le risque opérationnel attendu est la terminalisation de demandes auparavant
réessayées sans fin ; aucun FAILED n'est réarmé automatiquement. Le rollback
porte uniquement sur le commit de qualification des erreurs, sans migration
ou suppression ; il ne doit pas effacer les résultats terminaux existants.

### Certificat canari corrélé en mode direct

Le certificat ne peut plus être établi par différence des compteurs de toute
une fenêtre de trafic. En mode `worker-direct`, la réponse d'admission porte
déjà `X-Tobirink-Request-Id`. Le même UUID aléatoire figure dans l'événement
`worker.request` de l'invocation ; celle-ci attend son collecteur ciblé puis
émet ses coûts `discovery` et `discovery-admission`. L'observateur conserve
cette association uniquement en mémoire. Aucun identifiant, corps, en-tête,
URL ou événement brut ne doit figurer dans les rapports de certification.

Pour chaque clé neuve, il faut simultanément un terminal `VERIFIED` avec la
référence exacte attendue, une seule enveloppe HTTP reconnue, le fournisseur
attendu, au moins un appel réel et exactement un résultat accepté par le
collecteur. Les coûts D1 du collecteur et de l'admission sont instrumentés
séparément : leur somme doit être présente, avec au plus 300 lignes lues.
Les écritures sont mesurées mais ne sont pas confondues avec les lectures.
Un trafic étranger, un coût incomplet, un doublon ou une trace absente ne peut
remplacer cette preuve. Une lecture de readiness peut légitimement coûter
zéro ligne ; sa corrélation, et non un appel fournisseur, établit la réception.
Un premier coût `backoff` sans fournisseur est accepté seulement s’il annonce
une continuation Queue unique portant le même UUID. L’observateur attend alors
le coût terminal corrélé; le total final doit toujours contenir l’appel réel
au fournisseur attendu, faute de quoi le certificat reste `INCOMPLETE`.
Un réveil ciblé trop tôt est également `backoff` : il conserve ce même jeton
opaque et cet UUID, sans claim ni tentative supplémentaire, et reporte le
signal de 1 à 900 secondes. Le budget de 300 lectures D1 cumule l’admission,
les différés et le terminal ; il est contrôlé avant même le premier appel.
Un coût `provider:none` sans UUID corrélé ou sans cet envoi unique est refusé.
Les erreurs Queue et 429 arrêtent toujours le canari, sans second POST.

La régression locale du 27 septembre reproduit l’admission exacte Spirit
Circle, un différé de 120 secondes, un réveil une seconde trop tôt puis un
unique appel MangaUpdates et `VERIFIED`. Le défaut reproduit qualifiait le
réveil anticipé `unchanged` malgré sa continuation, provoquant le rejet du
certificat. Cette preuve locale ne certifie pas la production : la paire du
run `36336847567` reste un échec, sans réadmission. Après PR et CI protégée
vertes, une seule paire neuve est autorisée via `run_manga_canary=true` et
`publish_extension=false`. Lire ensuite les agrégats D1/Queue/Worker ; ne
préparer le lot historique scellé qu’après deux preuves complètes et demander
une confirmation immédiate distincte avant tout réarmement `FAILED`.

Certification du 27 septembre, après PR #143 et CI `36338487755` verte :
le run unique `36338898685` réussit sur `565d1b3`, Worker
`37d84956-1042-489b-80d8-7ce059a719ad`. Anime et manga sont `VERIFIED`, avec
un appel fournisseur corrélé chacun, respectivement 93 et 105 lectures D1,
34 écritures cumulées, zéro retry, 429 ou erreur Queue/fournisseur. Ce run
direct ne rencontre pas de différé (`queueSends=0`) ; la continuation différée
est couverte par la régression locale, pas exercée par cette paire distante.
La publication des archives est explicitement ignorée.

Lecture agrégée à 18:06 UTC : D1 compte 958 `VERIFIED`, 502 `FAILED`,
un `PENDING` et trois `PROCESSING` ; la requête diagnostique coûte 3 036
lectures et zéro écriture, hors budget canari. Les métriques approximatives
Queue indiquent neuf messages et deux en DLQ, sans âge disponible. Sur la
fenêtre canari 18:03:55–18:04:48 UTC, les métriques Worker globales indiquent
15 invocations, zéro erreur et 18 sous-requêtes ; elles ne remplacent pas
les deux preuves corrélées et ne certifient pas la santé du backlog.

Le lot local privé historique `manga-certified-20260927` contient dix mangas
issus d’une sélection D1 globale, sans preuve d’appartenance à la liste réelle.
Sa préparation avait lu 1 863 lignes et n’en avait écrit aucune ; aucun POST
de reprise n’avait été émis. Le prévol ultérieur retrouve zéro de ces dix
identités parmi celles en panne dans la liste réelle. Ce reçu reste intact,
ignoré par Git et privé en `0600`, mais n’est pas admissible à l’exécution du
runner désormais lié au scope. Son sceau n’est pas une certification du lot.

Le tail observe les invocations sans filtre textuel qui masquerait un échec
CPU avant émission de coût. Un outcome anormal, une exception, un 429 ou un
échec Queue observé arrête le lot. Les autres erreurs fournisseur et résultats
non publiés de l'invocation canari interdisent aussi le certificat. Les limites
de durée, d'octets et de mémoire restent fermées ; une saturation ou un
échantillonnage qui prive l'observateur de sa preuve produit `INCOMPLETE`.
Cette méthode ne certifie pas le chemin Queue asynchrone, qui ne partage pas
l'invocation HTTP. Elle n'affirme rien sur les événements non observés.

La campagne reste limitée à Odd Taxi/AniList et Spirit Circle/MangaUpdates,
une admission par clé neuve, sans retry de POST ni réarmement historique.
Le POST d'admission dispose de 45 secondes pour recevoir la réponse du
collecteur direct (deadline de résolution 30 secondes, hors D1) ; les lectures
restent à 15 secondes et la campagne entière à 24 minutes.
Un échec interdit la seconde admission si elle n'a pas encore eu lieu.
Les totaux du certificat ne comptent que les deux admissions corrélées ; ils
ne décrivent pas le trafic global de la fenêtre.
Le rollback du seul script revient à un observateur moins strict et ne doit
donc jamais être utilisé pour autoriser une reprise sur un ancien certificat
agrégé. Aucun changement Worker, protocole public ou archive d'extension
n'est nécessaire à cette corrélation déjà exposée par le runtime.

### Reprise liée à la liste réelle — prévol du 27 septembre 2026

Le profil temporaire conserve les 1 522 sources de l’export exact. Ses 458
sources `PROVIDER_UNAVAILABLE` correspondent à 398 identités Discovery
uniques. L’ancien lot global n’en couvre aucune (`0/10`). Le nouveau prévol
vérifie dix clés complètes et leurs payloads/digests contre la liste privée :
six `MANGA` et quatre `MANHWA`, toutes encore `FAILED/ATTEMPT_LIMIT` avec huit
essais. La lecture finale ciblée coûte dix lignes lues et zéro écriture.
Aucun POST d’admission n’est émis. Ces dix lectures ne représentent pas le
coût global des sondes précédentes ni celui des contrôles de runtimes.
Ce prévol ne certifie ni la reprise fournisseur ni la projection Library.

Après correction, le vrai CLI `--preflight --scope` confirme les dix
candidats issus du même export : six `MANGA`, quatre `MANHWA`, seize lectures
D1 (dix clés et six lectures de runtimes), zéro écriture et zéro admission.
Les trois runtimes sont `READY`. Un premier contrôle s’était arrêté sur
`scope-read-budget` ; le tri SQL inutile a été retiré, sans relever la limite
de dix lectures ciblées, et l’ordre du scope est rétabli en mémoire.
Un diagnostic SELECT séparé rapporte dix lectures sans écriture ; le coût
exact du premier refus n’a pas été conservé. Seize n’est donc pas le total
de toutes les sondes. Les deux reçus historiques restent byte-identiques ;
aucun `--prepare` ni `--execute` n’a été lancé pendant cette vérification.

Le runner `scripts/infra/discovery-recovery-batch.mjs` impose un fichier
`--scope` privé pour ses trois modes. Le schéma de scope version 1 contient
`corpusDigest`, `sourceCount` et une à dix `entries` uniques, chacune
constituée de `key` (`fingerprint`, `mediaKind`, `parserVersion`,
`siteRulesVersion`) et `requestDigest`. Les seuls médias admis sont `MANGA`
et `MANHWA`, ainsi que `ANIME` et `MANHUA`. Construire ce scope à partir des artefacts du profil réel,
jamais d’une sélection globale des plus anciens échecs D1. Le scope ne doit
contenir ni titre, ni URL, ni payload fournisseur. Conserver ce fichier et
le reçu local sous `build/recovery/`, ignorés par Git, en permissions `0600`.
Ne pas imprimer leurs digests ou leur contenu dans les logs, PR ou rapports.
Le chargement refuse un scope qui n’est pas un fichier régulier, dépasse
16 Kio ou expose des permissions groupe/autres sur un système POSIX.
Les sorties CLI ne contiennent aucun `batchSeal`, `scopeSeal` ou digest privé.

Le prévol et la préparation utilisent une requête SQL ciblée dont la CTE
de une à dix entrées pilote les recherches par index de clé primaire complète.
Le constructeur sépare SQL et paramètres ; la CLI Wrangler reçoit ensuite
les valeurs encodées après une allowlist stricte, pas des bindings API.
Ces contrôles exigent un payload v3 et un digest identiques au scope, ainsi
que les états et compteurs attendus. Les trois runtimes manga doivent être
présents ; un différé de cadence reste autorisé sans contourner le bail
Worker. Le journal version 3 porte `scopeSeal` et lie l’ordre des candidats
au scope exact. Un journal version 2, une clé partielle, un digest modifié
ou un scope différent sont refusés sans mutation ; aucun ancien reçu n’est
converti, supprimé ou réutilisé automatiquement.

Depuis la racine du dépôt, après création et vérification privée du scope :

```sh
node scripts/infra/discovery-recovery-batch.mjs --preflight --scope "$SCOPE_FILE"
node scripts/infra/discovery-recovery-batch.mjs --prepare "$BATCH_ID" --scope "$SCOPE_FILE"
```

`SCOPE_FILE` désigne le fichier privé attesté et `BATCH_ID` un nouveau nom de
lot ; un reçu existant ne doit pas être écrasé. Ces commandes ne réarment
aucune ligne. Après PR et CI vertes, un nouveau prévol et une confirmation
immédiate distincte du lot exact restent obligatoires avant la seule commande
mutante, non exécutée dans cette étape :

```sh
node scripts/infra/discovery-recovery-batch.mjs --execute "$BATCH_ID" --scope "$SCOPE_FILE"
```

Avant `POST_STARTED`, le runner réserve chaque clé v3 complète dans
un fichier permanent créé exclusivement avec `wx`,
en mode `0600`, puis écrit et synchronisé avec `sync`. La réservation
précède l’entrée `POST_STARTED` et tout POST d’admission. Deux processus ou deux lots
partageant le même répertoire ne peuvent pas réadmettre cette clé, même avec
un `requestDigest` différent ; le scope contrôle toujours ce digest. Une
interruption conserve la réservation même si le POST n’a pas encore été
envoyé ; ne pas la supprimer pour contourner le refus. Aucun nettoyage
automatique n’est prévu. Cette exclusion est locale, pas multi-machine :
garder un seul opérateur et le répertoire de reçus canonique, sans copie
ou autre clone pour relancer le lot.

Le runner persiste ensuite `POST_STARTED` et ne réessaie jamais ce POST.
Il attend le terminal avant d’ouvrir la fenêtre de soixante secondes pour
le coût final corrélé, y compris une lecture à la
borne. Un différé de 120 ou 600 secondes ne déclenche donc plus un faux
`cost-missing` après les seules soixante premières secondes. La deadline
totale reste de douze minutes par candidat ; elle n’est pas prolongée par
cette fenêtre. Un terminal sans appel fournisseur et coût corrélés reste
non certifié. Le budget de 300 lectures D1 cumulées, l’arrêt sur 429 ou erreur
Queue, `claim(1)`, Queue 1/1 et l’interdiction d’admettre la clé suivante sans
preuve complète sont inchangés. Un journal interrompu interdit le rejeu
automatique ; conserver le reçu et diagnostiquer en lecture seule.
Avant d’écrire `TERMINAL`, l’observateur est fermé et drainé, son état est
revérifié et le coût corrélé final est relu puis contrôlé. Une erreur tardive
de fermeture, de Queue ou de coût refuse donc le certificat et laisse la
tentative non terminale, sans libérer la réservation.

Le statut de ce lot reste **non certifié et non exécuté**. Cette correction
du ciblage et de l’observateur n’autorise aucun réarmement historique, aucun
nouveau canari et aucune publication d’archive. Le rollback se limite au
revert du correctif ; il n’autorise pas l’utilisation des anciens reçus et ne
supprime aucune donnée privée ou distante.

Livraison du correctif : PR #146, commit `2e91f32`, fusion `61b1abc`.
Le prévol CI `36352574525` est vert sur le SHA exact avant fusion ; la CI
`main` `36353030211` réussit ensuite vérification, E2E, plan, apply et sondes.
Aucune migration n’est à appliquer ; le Worker est publié en version
`442986f6-a4dd-4067-92b5-555474010a58`. Les quatre sondes `/`, `/library`,
`/download` et Deno `/healthz` répondent HTTP 200. Les étapes canaris et
publication d’archives sont ignorées. Ces sondes ne certifient pas les
favoris encore en pause et n’autorisent pas leur réarmement.

La validation complète locale passe dans le clone propre avec hooks actifs :
133 tests infra, dont 67 reprise/canari, 197 Worker, tous les typechecks et
`npm run verify`. Le workspace principal garde six erreurs de lint
préexistantes dans deux audits ignorés, sans suppression ni contournement.
Archify `architecture` passe en showcase 9/9, sans erreur ni avertissement ;
le HTML de reprise a été contrôlé sur quatre tailles desktop, en clair et
sombre, sans débordement, avec inspection des captures. L’interface fixe du
viewer reste en anglais ; le contenu du diagramme est en français.

### Premier lot de reprise historique — 26 septembre 2026

Après les deux canaris corrélés, une seule demande historique
`FAILED/ATTEMPT_LIMIT` a été resoumise par l'API v3 avec sa clé, son payload et
son digest vérifiés en mémoire. Le reçu privé a été créé en mode `0600` avant
l'I/O réseau. L'unique POST a répondu `202`; il ne doit pas être rejoué et
aucun SQL de mutation, second lot, migration ou publication d'extension n'a
été exécuté.

La même invocation corrèle deux appels MangaUpdates, un résultat accepté et
le terminal `VERIFIED`. Ses coûts sont 236 lectures et 100 écritures D1 pour
le collecteur, puis 20 lectures et 6 écritures pour l'admission, soit 256
lectures et 106 écritures au total. Les compteurs 429, erreurs HTTP/réseau,
échecs Queue et retries sont tous à zéro. L'enveloppe Worker répond `202`,
porte `outcome=ok`, consomme 31 ms CPU, n'est pas tronquée et ne contient
aucun événement d'erreur corrélé. La version
`eaa9fa6c-22c1-4353-a10e-7ddfe05d1de2` était active à 100 % pendant
l'opération; la Queue était alors non pausée avec batch 1/concurrence 1/huit
retries.

La lecture D1 postérieure, sans écriture, retrouve exactement une ligne
terminale dans cette fenêtre : requête `MANGA`, candidat `MANHWA`, compteur
d'essai réinitialisé à 1, raison et date d'échec effacées, candidat lié et
`request_json` minimisé. Le matcher métier de production accepte cette
classification compatible avec un titre `ordered-exact`. Le runner privé a
néanmoins refusé son propre certificat `result-media-mismatch`, car sa garde
locale exigeait une égalité stricte des médias. Cette erreur de preuve est
conservatrice : la mutation métier a réussi, mais le runner ne doit pas être
relancé pour fabriquer un autre certificat.

L'observateur autorise désormais `provider: 'any'` uniquement pour une reprise
dont le fournisseur réel n'est pas prédictible. Cette valeur exige toujours
un fournisseur différent de `none`, au moins un appel, exactement un résultat
accepté et toutes les bornes de coût et d'erreur ordinaires. Une attente omise
ou mal formée est refusée avant la corrélation.

Les compteurs agrégés après l'opération sont 458 `VERIFIED`, 418 `FAILED`,
28 `NOT_FOUND` et 16 `AMBIGUOUS`, pour 920 demandes. Une autre demande
`PROCESSING` a terminalisé dans la même période, donc ces totaux ne suffisent
pas à attribuer chaque transition; la ligne horodatée et la télémétrie
corrélée établissent la reprise ciblée. Cette preuve ne certifie ni la voie
Queue asynchrone, ni la projection Library, ni la convergence des 1 522
favoris conservés.

### Diagnostic Kitsu et lecture réelle du profil — 26 septembre 2026

Ne pas attribuer un échec global de Discovery à la gateway sans distinguer les
transports. En mode `selective-gateway`, AniList et MangaUpdates passent par
Deno ; MangaDex et Kitsu sortent directement du Worker. Le probe
`GET https://tobirink-provider-gateway.tobirink.deno.net/healthz` répond
`200 {"status":"healthy"}` et les canaris corrélés AniList/MangaUpdates sont
`VERIFIED`. D1 contient 458 `VERIFIED`, 418 `FAILED/ATTEMPT_LIMIT`,
28 `NOT_FOUND`, 16 `AMBIGUOUS` et aucun travail actif. La Queue principale
reste vide avec batch 1/concurrence 1 ; sa DLQ conserve 13 messages
historiques sans reprise automatique.

La reproduction sûre relit seulement les trois demandes anime historiques
`FAILED`, garde leurs titres en mémoire et exécute l'adaptateur Kitsu local.
Deux recherches aboutissent ; la troisième reçoit HTTP 200 puis rejette une
couverture dont l'origine n'appartient pas à l'allowlist. Aucun titre, URL,
empreinte ou corps fournisseur n'est journalisé. Ce signal prouve une erreur
de projection Kitsu directe après réponse, pas une panne Deno.

Le correctif conserve l'allowlist : une couverture étrangère optionnelle est
omise au lieu d'invalider l'identité. Une ressource du mauvais type ou dont
l'identité ne peut pas être encodée est écartée. Toute omission marque la page
incomplète et arrête sa pagination locale afin qu'elle ne produise jamais un
faux `NOT_FOUND`. Si aucun candidat exact n'est retenu, le résolveur transforme
ce signal en code fermé `provider-search-cursor`, sans donnée fournisseur, et
l'essai est consommé. La validation et la projection restent sous la gate
fournisseur ; un rejet résiduel alimente donc le circuit au lieu d'être compté
à tort comme succès. Les exceptions réellement levées et les erreurs D1/Queue
utilisent seulement des codes fermés, sans reprendre le message brut. Le rejeu
local des trois mêmes
demandes passe de deux succès et un rejet à trois succès, zéro erreur, treize
candidats et une enveloppe incomplète ; aucune ligne D1 n'est modifiée.

Le profil Chromium temporaire `Ujbd9g` exécute ensuite la lecture réseau réelle
avec budgets admission/refresh nuls. Il conserve 1 522 sources, transmet
1 064 GET et zéro POST, projette 301 Work et une Library de 1 413 entrées,
vérifie les redémarrages et termine `incomplete`. Les 640 `ADMISSION_WAIT`,
299 `PROVIDER_UNAVAILABLE`, 143 `NETWORK` et 39 `IDENTITY_MISSING` interdisent
de déclarer la convergence. Cette preuve ne justifie aucun réarmement massif :
déployer d'abord le correctif, exiger un canari par titre corrélé, puis reprendre
au plus une demande historique expressément autorisée.

## Arrêt du pilote installé du 28 septembre 2026

Le pilote suivant `q8QmHm` s'arrête après deux envois : premier résultat
VERIFIED projeté dans Library, second HTTP 503. Huit clés restent intactes.
Une lecture MangaDex bornée et les lectures D1 indexées isolent deux identités
MangaDex différentes partageant un seul alias, sans référence commune. La
régression locale reproduit `stale-public-discovery-result` lors de la
publication de la seconde identité.
La migration additive `0028` signale les titres partagés par `ambiguous = 1`;
ces lignes ne sont plus des associations uniques. La publication atomique
préserve les identités et les références fournisseur uniques, sans fusion,
effacement ou requalification artificielle en Review. Le déploiement suit la
CI protégée, migration avant Worker. Un rollback conserve la colonne et les
données ; l'ancien garde peut de nouveau bloquer ces publications, sans
annuler les résultats déjà produits. Les clés consommées ne sont pas rejouées.

Après livraison, la seconde identité devient VERIFIED par continuation, sans
nouveau POST ; cela ne certifie pas rétroactivement le pilote interrompu.
Le pilote suivant s'arrête après trois envois sur un dépassement de coût :
5 337 lectures pour le collecteur d'une publication. Le plan distant
`EXPLAIN QUERY PLAN`, sans écriture, démontre un parcours complet des titres
canoniques malgré la clause de sélection bornée. Publication et replay imposent
donc l'index primaire canonique avec `INDEXED BY`. Une régression locale avec
statistiques de cardinalité périmées reproduit le parcours complet, puis
vérifie la recherche par les trois colonnes et les budgets inchangés. Aucun
`ANALYZE`, changement de statistiques ou nouveau réarmement distant n'est
effectué pour ce correctif ; le rollback du code conserve toutes les données.

Le lot installé suivant réserve ses dix clés et observe quatre VERIFIED, une
AMBIGUOUS projetée en Review et cinq PENDING avant un arrêt de corrélation.
Les coûts Worker corrélés montrent un réveil Queue portant l'identifiant de
l'admission mais sans claim ni fournisseur : `provider:none`, `unchanged`,
zéro envoi Queue et 78 lectures D1. Ce réveil vide n'est ni un résultat ni une
nouvelle admission. L'observateur le conserve dans le coût cumulé de sa clé,
exige une continuation antérieure effectivement programmée, et attend toujours
un appel fournisseur final et un état terminal dans les bornes existantes.
Un réveil isolé, une erreur Queue, un coût supérieur à 300 ou l'absence de
résultat final restent des échecs. Les dix réservations sont consommées ; le
lot interrompu ne devient pas certifié a posteriori et aucun POST n'est rejoué.

Le diagnostic ciblé du profil complet `JB9dN3` lit cinq clés sans écriture.
Les quatre attentes manga n'ont aucun curseur persisté; la composition Worker
omettait le quatrième argument `searchProgress` du port `defer`. Une régression
intégrée reproduit cette perte après quatre pages, indépendamment de l'état
des fournisseurs, puis sa perte lors d'un report de cadence ultérieur. Le
correctif transmet le nouveau curseur ou conserve celui déjà réclamé sans modifier les claims,
la Queue ou les règles de reprise. Les états distants doivent encore être
observés après livraison; aucun `FAILED` n'est réarmé par ce correctif.
La cinquième clé correspond à un résultat négatif expiré : une nouvelle
admission normale reste distincte d'une reprise épuisée et n'est pas autorisée
par le test en lecture seule.

Le pilote `JH9olk`, autorisé après le correctif de coût, atteint dix sources
expliquées à 138 secondes : neuf œuvres dans Library et une exclusion
`BLOCKED_CONTENT_TAXONOMY` par la règle métier existante. Les snapshots après
redémarrage du worker puis du navigateur restent identiques. Le verdict final
reste pourtant `failed/read-network-failed`; il n'est pas remplacé par succès.
Le banc doit clore sa phase de lectures après corrélation : il conserve les
coûts par UUID en privé, refuse sans transmission toute nouvelle lecture,
puis draine celles déjà acceptées avant les redémarrages locaux. Une erreur
d'une lecture déjà engagée reste fatale; les gardes de mutation ne changent
pas. Les dix réservations restent consommées, sans nouveau POST.

La relecture historique bornée retrouve les dix corrélations et leurs coûts
d'admission : 31 appels fournisseur, dix résultats acceptés, 1 242 lectures
D1 et 740 écritures; maximum 144 lectures par clé, zéro erreur fournisseur,
429 ou Queue dans ces événements. Les reçus restent privés dans
`build/recovery/pilot-JH9olk-cost-evidence.json`. Les lignes scannées par
l'outil de télémétrie ne sont pas des lectures D1. La copie hors ligne
`pilot-preservation-7nr1ct` conserve exactement les dix sources, neuf œuvres
et les tables privées après deux redémarrages navigateur; profil original
inchangé, zéro requête transmise. Cette preuve complémentaire ne réécrit
pas le verdict échoué du banc initial et ne certifie pas les 1 522 sources.

Le troisième lot expressément confirmé utilise le ZIP Chrome 1.0.48 exact
et le Worker fusionné en `1daa9fc`, CI principale `36401186318` verte.
Le pilote privé `PbFEAL` s'arrête avec `correlation-failed` : six réservations
et POST comptabilisés, cinq corrélations enregistrées, quatre lectures
navigateur. Aucun renvoi n'est exécuté; les quatre autres clés restent intactes.
La relecture historique des 48,509 secondes du pilote identifie une invocation
avec 38 lectures D1 d'admission et 290 de collecte, soit 328 pour la clé.
Le rejeu local de ces événements reproduit exactement
`discovery-canary-observer-d1-budget`. La borne de 300 reste inchangée.
Les cinq coûts corrélés disponibles comportent quatre résultats `changed`
et un `backoff`, sans 429 ni erreur fournisseur ou Queue dans ces relevés.
Cela ne certifie ni la sixième réponse ni Library. Les deux lectures de
télémétrie parcourent respectivement 1 358 399 et 3 079 lignes de journaux,
distinctes de D1; leurs reçus sont privés en mode 0600. Aucun nouveau lot
ne doit partir avant reproduction et réduction du coût D1, sans retirer
les gardes de publication atomique ni relever le budget.

La reproduction synthétique à 32 titres mesure 442 lectures pour la seule
publication. La transition terminale gardée est désormais la première écriture
du batch D1; son jeton, conservé uniquement jusqu'à la fin du batch, autorise
les projections suivantes sans répéter sept fois les recherches de conflits.
Le même cas mesure 114 lectures et 208 écritures, conserve les 32 titres et
coûte une écriture de plus pour clôturer le jeton. Les tests injectent une
erreur SQL après les projections et vérifient le rollback complet, puis font
concourir deux publications sur le même titre canonique : une seule réussit.
La borne globale de 300 inclut toujours admission et continuations; cette
mesure locale ne certifie pas rétroactivement le pilote interrompu.

Le second essai autorisé `tdqu7R` s'arrête après six admissions corrélées et
un doublon bloqué avant transmission. Les six réservations sont consommées,
les quatre autres clés intactes; aucun renvoi n'est permis. La lecture de
contrôle retrouve trois résultats `VERIFIED` et trois `PENDING`, sans certifier
le coût ou la projection locale. Le timeout `PENDING` du navigateur ne doit
pas réadmettre une demande : la candidate 1.0.48 conserve une lecture seule
et un prochain contrôle au moins une minute plus tard. La Queue et sa
continuation restent responsables de l'exécution; aucune garde serveur
ni limite d'admission n'est assouplie.

La relecture historique des journaux est limitée aux six corrélations et à
leur fenêtre initiale de douze minutes; elle ne relance aucune demande.
Neuf enregistrements de coût totalisent 43 appels fournisseur, trois résultats
acceptés, 901 lignes D1 lues et 260 écrites. Aucun 429 ni erreur réseau ou
Queue n'y apparaît. Ce relevé reste partiel : trois chaînes n'ont pas de
résultat terminal prouvé, et aucune projection Library n'est certifiée.
Une continuation sans appel fournisseur ni nouvelle émission ne vaut pas succès.
La requête de télémétrie a parcouru 1 620 313 lignes de journaux (674 995 745
octets), distinctes des lectures D1; ne pas répéter ce balayage pour surveiller
le lot. Les reçus détaillés restent privés. Aucun coût de campagne n'est
extrapolé depuis cet échec; la cause des continuations incomplètes reste à
reproduire localement avant tout élargissement.

Une course est maintenant reproduite sur D1 local : à l'échéance du différé,
un réveil générique peut réclamer la ligne avant son signal ciblé, remplacer
son jeton et publier sans l'UUID d'admission. Cela démontre un défaut possible,
pas la cause certaine de chacune des trois attentes historiques. La protection
des jetons PENDING pendant quinze minutes sans progrès empêche cette course
dans la fenêtre du pilote; les claims ciblés restent éligibles à leur échéance.
Le calcul du réveil générique respecte la même borne; les baux PROCESSING
expirés restent récupérables et un jeton orphelin redevient éligible à quinze
minutes. Les 200 tests Worker passent, y compris refresh, curseur, concurrence
et récupération. Aucun appel réel ni réarmement ne sert à cette validation.

Le pilote privé `jfltzN`, explicitement autorisé sur dix identités, s'arrête
après une réservation POST : `read-network-failed` pendant
le redémarrage du navigateur. Aucune corrélation d'admission n'a été reçue;
la réception et le résultat distants du POST ne sont donc pas certifiés. La lecture de contrôle
indexée d'une seule clé renvoie HTTP 200 / `UNAVAILABLE`. La réservation
reste consommée; aucun renvoi, autre lot ou élargissement n'est exécuté.

Le banc diffère désormais les redémarrages du pilote après la projection,
la corrélation, la pause explicite et le drainage des routes. Les preuves de
l'échec restent privées et intactes. Ce correctif local ne certifie pas les
dix reprises et ne permet pas de rejouer la clé interrompue.

Le pilote `qhnT56` du lot privé `batch-003`, confirmé séparément, a réservé
et transmis exactement dix POST via le bouton installé. Neuf œuvres sont
projetées dans Library et une demande reste `PENDING`; le contrôle public
en lecture seule retrouve neuf `VERIFIED` et une `PENDING`. Le banc s'arrête
à 280 secondes sur `correlation-failed` avant la preuve des dix coûts et des
redémarrages. Le verdict reste `failed`, sans certification ni estimation de
campagne. Aucune de ces dix clés ne sera renvoyée. Les dix reçus et le rapport
privés sont conservés; le profil complet précédent reste à 1 033 résolues,
47 Review, 53 exclusions et 389 reprises avant cette projection.

Le diagnostic du banc conserve désormais dans son rapport privé et son résumé
un code fermé issu de l'observateur (`discovery-canary-observer-*` ou
`discovery-recovery-*`), avec repli générique pour tout message inconnu.
Cette modification n'identifie pas rétroactivement la cause du pilote
`qhnT56`; elle évite une nouvelle reprise aveugle. Aucun nouveau lot ne
part tant que cette cause et la continuation restante ne sont pas expliquées.

Une lecture D1 ultérieure par les dix clés primaires (dix lignes lues, zéro
écrite) confirme neuf `VERIFIED` et une ligne active. À 14:18 UTC, cette
dernière est `PENDING`, tentative 0, curseur MangaUpdates 45 : la continuation
progresse, mais elle dépasse déjà la fenêtre de certification du pilote.
Le jeton Wrangler est refusé depuis l'IP courante (`9109`) ; le connecteur
Cloudflare permet toujours les lectures indexées. Une unique recherche
historique Observability sur sept minutes a parcouru 2 238 332 lignes et
218 Mo sans fournir de trace exploitable. Aucun autre balayage historique
de ce type n'est lancé : son coût est disproportionné pour le diagnostic.

Le profil complet `JB9dN3`, repris avec le même export Downloads après
sauvegarde de sa copie isolée, a terminé sa fenêtre locale de 895 secondes sans admission
ni refresh : 1 522 sources = 1 042 résolues, 47 Review, 53 exclusions et
380 reprises (370 `PROVIDER_UNAVAILABLE`, neuf `PUBLIC_DISCOVERY_PENDING`,
une `NETWORK`). Library contient 837 œuvres ; aucune projection ne manque et
aucune erreur interne n'apparaît. Les compteurs restent identiques après
redémarrage du service worker et du navigateur. Cette exécution a transmis
484 lectures, bloqué 14 mutations et consommé 4 235 des 5 000 emplacements
de lecture cumulés ; son verdict reste `incomplete`.

À 14:39 UTC, la seule demande non terminale du lot `batch-003` est encore
`PENDING`, tentative 0, avec curseur MangaUpdates 65 et zéro candidat retenu.
Ses lectures D1 ciblées restent à une ligne lue et zéro écrite chacune.
La Queue conserve un consommateur `1/1`, sept messages en attente et un plus
ancien d'environ douze minutes. Trois recherches synthétiques publiques de
MangaUpdates (aucun titre privé) ont répondu 200 ; `stype:title` et
`orderby:score` n'ont pas diminué les 1 295 résultats du terme de contrôle.
Modifier le filtre fournisseur sur cette seule hypothèse serait spéculatif.

Le goulot est maintenant reproduit sur la seule clé active, sans nouvelle
admission : son premier titre de 68 caractères renvoie `total_hits=10000`,
25 résultats par page jusqu'à la page 400, puis HTTP 400 à la page 401. Son
second titre renvoie zéro résultat. Une recherche directe à 100 résultats sur
la page correspondante répond 200 en 4 104 ms pour 136 629 octets, sous les
limites de huit secondes et 512 Kio. Ces essais sont des lectures fournisseur
opératoires, pas des preuves de résultat D1 ni des POST Discovery.

La candidate locale demande donc 100 résultats par page MangaUpdates et garde
le curseur historique exprimé en tranches de 25 : `81` devient la page 21,
dont le premier résultat suit exactement les 80 anciennes pages. Le prochain
curseur est `85`. Quatre tranches de 25 préservent l'inspection bornée et la
priorité globale des correspondances. Le plafond théorique passe de 400 à
100 appels fournisseur pour ce titre ; cela ne promet pas une résolution en
douze minutes avec Queue, cadence et autres travaux. Les dix réservations
`batch-003` restent consommées, le pilote échoué et la correction non déployée.

Le prévol suivant de `batch-004` trouve dix MANGA éligibles par 16 lectures D1
indexées, zéro écriture ou réservation. Wrangler local charge un ancien jeton
API depuis `.env` et reçoit `9109` depuis la nouvelle IP de box. Une nouvelle
session OAuth Wrangler, limitée aux 29 permissions déjà présentes, réussit
sans modifier `.env`; l'injection en mémoire de cet OAuth permet le prévol.
Le tail ne produit pas de preuve dans les dix premières secondes de la sonde
du banc, mais reçoit une lecture `MISS` synthétique corrélée après une fenêtre
plus longue. Le banc autorise donc au plus 24 sondes espacées de 2,5 secondes
avant le bouton (délai de garde 75 secondes), puis échoue fermé sans POST si
le tail reste absent. Ces lectures de démarrage restent hors budget par clé.

### Diagnostic CPU Queue — 2026-09-29

Le lot `batch-004` a consommé sept admissions avant un HTTP 503 et un signal
de continuation non envoyé ; les trois autres clés n'ont pas été admises.
Les sept réservations demeurent consommées et ne doivent pas être rejouées.
Les métriques Queue montrent zéro message en attente et deux messages en DLQ.
Trois invocations Queue corrélées dans Observability ont l'outcome
`exceededCpu` malgré une durée murale distincte : un simple accroissement du
délai d'observation ou un cron ne répare donc pas cette limite CPU. Le cron
`*/10 * * * *` est bien installé ; le claim et le consommateur restent à 1/1.

La candidate borne désormais à deux recherches fournisseur réussies par
invocation sans erreur fournisseur, puis persiste le curseur et émet une
continuation sans nouvel essai. Les échecs fournisseur gardent leur traitement
existant. Cette mesure ne vaut pas preuve de convergence : vérifier après
déploiement les outcomes CPU, la continuation corrélée, le résultat D1 et sa
projection Library avant tout élargissement des admissions.
