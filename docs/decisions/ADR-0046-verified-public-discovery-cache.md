---
scope:
  - packages/application/src/public-discovery/**
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-cloudflare/src/catalogue/**
  - packages/adapters-indexeddb/src/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/worker/migrations/**
  - apps/worker/src/catalogue/**
  - apps/worker/src/releases/**
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/operational-metrics.ts
  - apps/provider-gateway/**
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/systems/agenda-recovery-plan.md
  - docs/architecture/src/favorite-resolution.dataflow.json
  - docs/architecture/src/public-discovery.dataflow.json
  - docs/architecture/src/tobirink.architecture.json
review: on-change
revised: true
---

# ADR-0046 — Cache public de découverte vérifié sans propriétaire

- Status: accepted
- Date: 2026-09-14
- Revised: 2026-09-26
- Supersedes: le protocole Collectif, les owners et les confirmations humaines de l’ADR-0043; l’identité collective de l’ADR-0044

## Contexte

Un cache D1 ne réduit les recherches que s’il est alimenté. La première
version accordait un bail court à une extension afin qu’elle recherche les
fournisseurs et propose des identifiants. Elle empêchait les recherches
textuelles concurrentes, mais conservait les APIs fournisseurs, leurs
permissions et l’hydratation exacte dans l’extension. Elle ne réalisait donc
pas la frontière D1-first attendue.

Le besoin est de réutiliser une œuvre déjà résolue sans envoyer l’URL, le
dossier, la progression ou une bibliothèque. L’extension doit seulement lire
D1 ou y matérialiser une requête publique bornée. La recherche, la sélection et
l’hydratation appartiennent à un composant serveur extractible exécuté par le
consumer Queue natif du Worker. Un résultat fonctionnel, y compris introuvable ou ambigu, doit
être persistant afin que la même requête ne relance pas les fournisseurs.

## Décision

Le protocole public v3 utilise une clé versionnée composée de l’empreinte
SHA-256 du titre canonique local, du type média, de la version du parseur et de
la version des règles. La demande contient deux listes contenant chacune au
plus quatre titres nettoyés et bornés, plus les marqueurs publics nécessaires au
matching : média, saison, format OVA et prépublication. Ces titres et leur
empreinte sont devinables et ne sont pas présentés comme anonymes. Le Worker et
D1 ne leur associent aucun owner, installation, compte, URL, dossier,
progression ou bibliothèque. Les logs applicatifs n’enregistrent ni clé ni
contenu de demande.

Le schéma filaire de ce protocole porte `schemaVersion: 3`. Les tables D1
actives de demandes et de nonces portent le suffixe `_v3`; une migration par
renommage conserve les lignes produites par l’implémentation interne initiale
sans les recopier ni les supprimer.

Une lecture renvoie exactement un état :

- `MISS` : aucune association ni demande active;
- `PENDING` : une demande bornée existe ou attend une reprise transitoire;
- `UNAVAILABLE` : les huit tentatives serveur sont épuisées et une reprise explicite est requise;
- `VERIFIED` : le composant autorisé a publié un profil fournisseur complet;
- `NOT_FOUND` : toutes les lanes applicables ont répondu sans correspondance;
- `AMBIGUOUS` : plusieurs identités restent crédibles et sont conservées pour
  une Review locale sans nouvelle recherche fournisseur.

Sur `MISS`, le Worker classe atomiquement l’admission en `created`, `existing`
ou `saturated`. Seule la transition `created` émet le signal Queue opaque;
il contient un jeton aléatoire de sélection et un UUID de corrélation, mais ni
clé, empreinte, titre, URL ni payload. D1 conserve uniquement le SHA-256 du
jeton dans `claim_token_hash`. Le consumer sélectionne la ligne portant ce
digest avant de remplacer le claim par son propre jeton de publication;
un POST concurrent ou répété classé `existing` n’ajoute aucun message. Un petit
outbox D1 passe par `UNSENT`, `SENDING` et `SENT` : si l’émission initiale
échoue, la ligne `PENDING` revient à `UNSENT` et un POST identique peut reprendre
l’envoi non confirmé. Une soumission identique peut aussi réparer un signal
`SENT` ancien ou un bail expiré, sans voler un bail actif ni remettre les
tentatives à zéro. Cette réparation concerne également les refreshs existants.
L’extension ne reçoit aucun bail, ne propose aucun
identifiant et n’appelle aucun fournisseur. Une seconde soumission de la même
clé doit porter le même digest de requête; un contenu différent est refusé au
lieu d’écraser le travail existant.

Le consumer reçoit un signal par invocation et exécute un seul
`claim(1)` ; le résultat vérifié est publié dès sa disponibilité.
Chaque résolution possède aussi une deadline applicative de trente secondes :
si un transport amont ou une opération d’infrastructure reste suspendu, le
claim est différé comme une erreur fournisseur retryable au lieu de rester
`PROCESSING` jusqu’à l’expiration du bail de quinze minutes.
Le budget d'une invocation Discovery conserve `claim(1)` et compte les appels
D1 avant exécution, indépendamment des métriques de lignes `worker.cost`.
Un batch D1 constitue un appel RPC, sans confondre ce nombre avec ses statements
SQL ni avec ses lignes lues/écrites. Avant chaque opération publique fournisseur
`search` ou `hydrate`, la composition Worker exige
`appels consommés + réserves en cours + 4 + 7 + 2 × autres claims restants + 1 <= 50`.
Les quatre appels couvrent la réservation de cadence, son éventuelle relecture,
le succès et un éventuel échec; sept couvrent la publication ou le report de
l'œuvre courante (mutuellement exclusifs), deux par autre claim restant
couvrent les reports de refresh, et un couvre la continuation D1.
La réserve d'une opération fournisseur n'est libérée qu'au settlement réel,
même après la deadline. Une résolution fermée ne démarre plus d'autre port;
les opérations déjà lancées conservent leur réserve jusqu'à leur terminaison.
Un refus de budget ferme les appels fournisseur du lot. Les demandes suivantes
sont différées sans consommer d'essai. Si la première œuvre du claim épuise le
budget d'une invocation fraîche, elle suit l'échec borné consommant l'essai,
avec continuation au bail et terminalisation après huit tentatives; sinon elle
est différée pour disposer d'une invocation fraîche. Le refus garde un état
local discriminé, prioritaire sur une conversion d'erreur ou un résultat tardif
du resolver : il ne peut jamais publier `NOT_FOUND` ni créer un réarmement infini.
Son diagnostic fermé est `public-discovery-invocation-budget`, distinct d'une
panne fournisseur et sans contenu métier. Le compteur couvre les méthodes de
la binding utilisées par les collecteurs; `withSession()` reste un passthrough
non compté, jamais utilisé dans cette composition. Le passage à des sessions
exigerait d'étendre ce compteur avant de conserver la garantie de budget.
Après le lot, une lecture de la ligne réclamée conserve une continuation Queue
retardée de 1 à 900 secondes et le même UUID si cette ligne reste active. Le
report de cadence garde le digest du claim comme sélecteur; un échec consommant
le garde jusqu'à l'expiration du bail. Un claim vide peut seulement programmer
un réveil générique sans UUID de certification. L’échec de cet
envoi conserve le signal entrant par retry. Le claim ordonne
les demandes par référence fournisseur exacte, média précis, puis recherche
ambiguë, avant l’ancienneté et l’empreinte.
La sélection réunit deux branches disjointes sur les index partiels existants :
demandes actives et refreshs actifs. Le tri global et le `LIMIT` restent dans
la même instruction atomique de claim. L’expiration des huitièmes tentatives
utilise également ces index; elle ne parcourt pas l’historique terminal.
`nextPendingAt()` conserve le minimum des échéances sur les seuls index actifs.
Le nombre de lectures dépend donc encore du travail actif à examiner, pas
seulement du nombre de demandes retournées : `claim(1)` n’est pas une garantie
d’une seule ligne lue. Les `UPDATE` de claim et d’expiration reprennent aussi
le prédicat d’état actif à l’extérieur de leur sous-requête, pour éviter un
scan de l’historique terminal avant la recherche sur les index partiels.
Si seules des réservations de cadence ou des réponses `429` empêchent un
résultat fournisseur, le collecteur libère le bail, remet la demande (ou son
refresh) à `PENDING` et restitue la tentative prise au claim. Entre plusieurs
reports, l'échéance la plus tardive est conservée. Le pointeur de continuation
Queue suit cette échéance.

Une erreur ordinaire de transport, HTTP hors `429` ou validation ne devient
pas une attente de cadence. Si aucun fallback n'aboutit, elle consomme la
tentative et laisse le bail existant expirer avant la prochaine prise. Une
cadence ou un `429` rencontré plus tard ne peut effacer cette dépense ; cela
vaut aussi entre les deux lanes `UNKNOWN` et pendant le fallback d'hydratation.
La priorité conservée est recherche structurellement incomplète, erreur
ordinaire, puis report typé. Les erreurs ordinaires de même priorité gardent
la dernière cause ; un fallback réussi reste autorisé. Après huit échecs
consommants et expiration du dernier bail, D1 expose `UNAVAILABLE/ATTEMPT_LIMIT`.
Une panne ne produit jamais un `NOT_FOUND` implicite ; un refresh échoué
conserve le profil `VERIFIED` déjà publié.

Le composant portable de l’ADR-0047 lit les demandes v3 en attente via une source
injectée. Il route la recherche vers AniList, MangaUpdates, MangaDex, Kitsu
Anime ou Kitsu Manga selon le type média, applique le matcher versionné, puis
hydrate l’identifiant exact retenu. Dans une lane, une panne transitoire (403,
404, 429, 5xx, timeout ou réponse incomplète) ouvre le fournisseur suivant;
si toutes les lanes applicables échouent, la demande reste active avec une
reprise bornée par les règles de bail et de dépense ci-dessus. Une lane
`UNKNOWN` ne publie jamais l’autre média lorsqu’une
lane est indisponible. Il produit exactement un résultat `VERIFIED`, `NOT_FOUND`
ou `AMBIGUOUS`; une panne effective ne devient jamais un `NOT_FOUND` implicite.
Le Worker conditionne chaque publication au bail et au digest courants; il
demeure l’unique auteur des tables publiques fiables.
Les recherches sans référence exacte des lanes `MANGA`, `MANHWA` et `MANHUA`
interrogent `MangaDex`, puis `Kitsu Manga`, puis `MangaUpdates` : une preuve
exacte rapide peut ainsi terminer la demande avant que la pagination cadencée
de MangaUpdates n'épuise la fenêtre partagée, sans convertir une recherche
incomplète en résultat négatif. Le repli après l'hydratation transitoirement
indisponible d'une identité recherchée suit le même ordre restant; une référence
exacte explicite continue d'hydrater uniquement son fournisseur.

La clé D1 possède un index unique. Demande, prise de travail et publication sont
idempotentes. Un seul collecteur peut posséder un bail de traitement actif; les
lectures voient `PENDING` et n’appellent aucun fournisseur. Un résultat rejoué
avec le même digest ne change rien. Le collecteur checkpoint son étape avant
chaque reprise. `VERIFIED` ne redevient jamais `PENDING` : `refresh_state`
porte séparément `IDLE`, `PENDING` ou `PROCESSING`, de sorte que l’ancien profil
reste servi avec `verifiedAt` et `nextRefreshAt` pendant toute réhydratation.
`NOT_FOUND` et
`AMBIGUOUS` restent frais sept jours; après leur échéance explicite, la lecture
renvoie `MISS` et une nouvelle admission peut recréer exactement un travail. Une panne
entre un appel fournisseur et son checkpoint peut encore répéter cet appel :
aucun protocole distribué ne peut garantir exactement-une-fois face à ce crash,
mais la répétition concurrente et toute répétition après résultat terminal sont
interdites.

Une huitième tentative dont le bail expire passe en état D1 interne `FAILED` et
la lecture publique renvoie `UNAVAILABLE`. Aucun polling de l’extension ne
réarme cette demande. La reprise explicite peut resoumettre le POST d’admission
avec la même clé et le même digest. La transition conditionnelle remet alors
les tentatives à zéro seulement si une place est disponible; un digest différent
reste un conflit. Une demande déjà active ne perd jamais ses tentatives ni son
bail lors d’une resoumission.

Le client conserve dans `storage.local` une cadence commune aux admissions et
refreshs, avec au moins 1,1 seconde entre deux réservations. La limite serveur
reste 60/minute par IP. Un `429` expose `Retry-After`, conservé après redémarrage.
Une échéance PENDING durable empêche qu’une lecture repousse indéfiniment sa
resoumission. Chaque HTTP expire au plus tard après 15 secondes, corps compris,
ou à l’échéance du réveil si elle arrive avant. Au moins une seconde restante
est requise pour commencer; exiger quinze secondes disponibles provoquait une
attente perpétuelle après une préparation dépassant cinq secondes.
Attente serveur, admission, quota,
réseau, timeout, indisponibilité, conflit et réponse invalide restent distincts.
Les attentes et indisponibilités transitoires ne consomment pas de tentative
locale; les erreurs de contrat restent actionnables et bornées.

Le client partage un échange en vol uniquement entre appels portant la même
clé et la même requête validées. Une requête différente n'hérite jamais du
résultat d'une admission concurrente. L'échéance écrite avant le POST reste
opposable après une réponse perdue et un redémarrage, même si la lecture
suivante répond encore `MISS` : le client expose alors `ADMISSION_WAIT`, sans
inventer un état serveur `PENDING`. Une lecture terminale garde la priorité.

Une ambiguïté publique transporte des références, pas nécessairement des
profils complets. La Review locale conserve cette preuve distincte des
candidats hydratés; elle ne fabrique ni titre fournisseur ni Work vérifié.
Le choix humain d'une référence passe par Public Discovery avant tout commit.
Les messages Review extension et WebBridge exposent cette liste via le champ
optionnel `providerReferences`, limité à dix identités validées. L'interface
réutilise l'action manuelle pour vérifier une référence; elle ne présente pas
un identifiant comme une fiche hydratée ni un PENDING comme un choix confirmé.
WebBridge v4 transmet ce champ seulement sur une lecture qui demande
explicitement les références. Une requête ancienne conserve sa réponse stricte
historique. Le nouveau client essaie une lecture enrichie bornée puis une
lecture ancienne si nécessaire; cette négociation ne rejoue jamais une
mutation et sa capacité est réévaluée après reconnexion.
Les diagnostics locaux restent observationnels même lorsque leur stockage
échoue. Aucun résultat métier ne devient une erreur interne pour cette raison.

La projection provisoire conserve le sous-type détecté par le parseur pour ses
facettes; le candidat fournisseur fait autorité après résolution. Les clés v3
ne sont ni renommées `COMIC` ni réécrites. Une famille compatible pour la
recherche ne prouve pas le sous-type réel d'une œuvre. Les comptes de sources,
de Works uniques et de cartes provisoires ne sont pas interchangeables.

Chaque écriture du catalogue et l’écriture terminale sont conditionnées dans le
même batch D1 par le bail non expiré, son token, le digest de demande et
l’absence de conflit de référence fournisseur. L’adaptateur n’accepte la
publication que si `meta.changes` vaut exactement `1` pour l’UPDATE terminal.

La publication `VERIFIED` matérialise aussi un index canonique unique sur la
version de normalisation, le titre normalisé et le type `anime` ou `manga`.
Toutes les variantes du profil sont vérifiées ensemble : une variante déjà
attribuée à une autre œuvre du même type rejette atomiquement la publication.
Le même titre reste permis entre anime et manga. Un rejeu terminal fiable
matérialise l’index manquant sans rappeler de fournisseur.

Les gardes canoniques de publication et de rejeu parcourent d'abord la liste
bornée `json_each` des titres proposés, puis recherchent la clé primaire
complète `(normalization_version, normalized_title, media_kind)` grâce à un
`CROSS JOIN` explicite. Le plan inverse ne contraignait que la version et
relisait tous ses titres pour chaque écriture. Les prédicats de conflit,
l'ordre des paramètres, les gardes de bail et le batch atomique restent
inchangés; aucun index ni migration n'est ajouté.

Au plus 5 000 demandes peuvent être simultanément `PENDING` ou `PROCESSING`.
Cette borne est vérifiée dans la même instruction SQL pour une nouvelle clé,
un réarmement `FAILED` ou une réponse négative expirée redevenant active.
À capacité pleine, ces admissions reçoivent `503` sans modifier la ligne ni
émettre de signal Queue. Une clé déjà active reste lisible et rejouable sans
occuper une place supplémentaire; un résultat terminal frais reste lisible.
Après terminalisation, `request_json` devient `{}` et le
résultat terminal est conservé comme cache. Une migration de backfill applique
la même minimisation aux lignes terminales antérieures, sans modifier les
demandes `PENDING`, `PROCESSING` ou `FAILED` nécessaires à une reprise. Les
nonces reçoivent une échéance à sept jours, les échecs `FAILED` à trente jours
et les révisions orphelines
deviennent éligibles après trente jours. Ces échéances n’autorisent aucune
suppression automatique : toute purge D1 exige sauvegarde, plan borné et
approbation destructive séparée.

Une réhydratation n’est admissible qu’après `next_refresh_at` et avance cette
échéance de sept jours dès l’admission atomique. Seule cette transition émet le
signal Queue; les demandes concurrentes réutilisent la même ligne. Le claim
reconstruit au plus quatre titres et une référence fournisseur exacte depuis le
profil `VERIFIED`, sans restaurer ni conserver l’ancien `request_json`. Un
résultat non `VERIFIED`, un échec ou l’épuisement des huit tentatives ne remplace
jamais le profil servi. Un profil sémantiquement identique met à jour les dates
sans réécrire les tables catalogue; un profil changé n’est publié qu’après les
mêmes validations atomiques de références et de titres.

Une relation saison, suite, source ou adaptation n'appartient plus au contrat
de sortie Discovery et ne crée jamais de demande ou signal Queue. La migration
`0025_drop_catalogue_work_relations.sql` retire la table historique vide après
sauvegarde et vérification de l'absence de consommateur. En revanche,
`linkedReferences` conserve jusqu'à
cinq références exactes de fournisseurs qui identifient la même œuvre; elles
sont dédupliquées dans `catalogue_external_references`. Une collision
fournisseur ou canonique refuse le batch au lieu de fusionner silencieusement
des identités distinctes.

Avant chaque requête HTTP réelle, le Worker réserve dans D1 la cadence et
l’exclusivité du fournisseur. AniList est limité à une requête toutes les trois
secondes, MangaUpdates à une toutes les six secondes; MangaDex et Kitsu restent
à une par seconde. Un `Retry-After` avance la prochaine autorisation. Trois
échecs consécutifs ouvrent par défaut le circuit quinze minutes; seuil et durée
sont des paramètres bornés de l’adaptateur. Un succès ferme le circuit. Ces
contrôles sont partagés entre isolates et ne comptent jamais une lecture D1 ou
un réveil différé comme appel fournisseur.

L’extension consulte d’abord IndexedDB, puis D1. Un
`VERIFIED` fournit directement le candidat hydraté complet utilisé pour écrire
le Work local avec `verifiedAt`, `nextRefreshAt` et la clé publique exacte.
Avant la résolution d’un lot, une unique requête HTTP lit jusqu’à cinquante
clés D1 et alimente le cache mémoire du réveil; le runner ne refait donc pas un
GET par favori. `PENDING` programme une relecture sans fournisseur. `NOT_FOUND`
et `AMBIGUOUS` terminent la tâche en Review locale sans relancer le composant.
Le chemin automatique, la réparation de couvertures et les actions manuelles ne
consultent aucun adaptateur de recherche ou d'hydratation fournisseur dans
l'extension. Une référence manuelle exacte utilise une clé dédiée incluant
fournisseur et identifiant, puis suit le même cycle D1/Queue. `PENDING` conserve
la Review; seul un profil `VERIFIED` qui contient cette référence peut être
commité localement. Les parseurs d'URL fournisseur restent locaux et sans
réseau; aucun adaptateur réseau fournisseur n'est composé par le background.

Après convergence, un checkpoint MV3 parcourt les sources observées par pages
de cinquante. Une fiche inchangée ne réécrit pas IndexedDB. Une fiche échue
n’est proposée à la réhydratation que le jour stable dérivé de son empreinte,
sur une fenêtre de sept jours, avec vingt admissions au plus par réveil. Le
curseur est persisté avant la suspension; une page incomplète programme la même
continuation ponctuelle que le runner. La réponse `VERIFIED` courante reste
lisible et seule une version `verifiedAt` plus récente remplace le profil local.

Le protocole ne possède aucun réglage Collectif, appairage ou consentement
produit spécifique. La permission navigateur native `bookmarks` et la
déclaration de collecte exigée par les boutiques restent exactes tant que
l’extension lit les favoris. La politique de confidentialité doit expliquer
la transmission de l’empreinte devinable et des identifiants publics; retirer
une UI maison ne retire pas cette obligation de transparence.

## Conséquences

Sur la fixture workerd du 23 septembre 2026 contenant 1 024 lignes terminales,
un réveil vide (expiration, claim et prochaine échéance) passe de 3 088 à
18 lignes D1 lues, sans écriture. Avec dix lignes de travail mixtes, quatre
claims dont deux concurrents et la lecture de continuation passent de
12 524 à 175 lectures; les vingt écritures restent identiques. Ces mesures
`D1Result.meta` sont locales et propres à la fixture, pas une projection de
coût de production. Les tests couvrent la priorité globale, l’exclusivité des
baux, les tentatives expirées et la conservation du profil pendant un refresh.
`EXPLAIN QUERY PLAN` confirme l’usage des index actifs existants, sans migration
ni nouvel index; le tri des candidats actifs demeure nécessaire.

Sur une seconde fixture locale de 582 œuvres et 2 328 titres canoniques, une
publication de quatre titres passe de 151 379 à 111 lectures D1 avec les
39 écritures inchangées. Son rejeu passe de 58 231 à 51 lectures sans écriture;
un conflit de titre passe de 58 118 à 41 lectures, toujours sans aucune écriture.
La régression workerd couvre la vraie publication, le rejeu, le conflit et le
plan extrait de la garde SQL réellement préparée : la recherche utilise les
trois colonnes de la clé canonique. Ces coûts sont ceux de cette fixture, pas
un multiplicateur du volume de demandes en production.

D1 reçoit immédiatement une ligne `PENDING` après le premier miss accepté,
puis un résultat terminal seulement après le traitement Queue. Les lectures suivantes
réutilisent ce résultat; les requêtes concurrentes attendent. Aucune extension
ne contacte AniList, MangaUpdates, MangaDex ou Kitsu pour cette découverte.

Les anciennes routes `/v2/catalogue/discoveries` et leurs sous-routes sont
retirées et répondent `410 Gone`. Les anciennes routes externes de claim et de
publication répondent également `410 Gone`; l’ingestion, la lecture et la
création de demande utilisent exclusivement v3.

Le cache ne représente aucune bibliothèque et ne peut pas restaurer la
progression privée. Les anciennes tables et migrations Collectif restent
versionnées pour rollback mais ne sont plus montées ni écrites. Leur éventuelle
suppression distante est une opération destructive séparément approuvée.
Les sauvegardes nouvellement produites n’embarquent plus d’identité owner; un
champ owner présent dans une ancienne archive est accepté pour compatibilité de
lecture mais ignoré par la composition actuelle lors de la restauration.

Les événements `worker.cost` comptent séparément les HIT/MISS groupés, les
admissions dédupliquées, les réhydratations acceptées, les appels fournisseur
réels et les lignes D1 rapportées par `meta`. Ils n’enregistrent jamais la clé,
les titres, les références, l’IP ou le profil. Une lecture ordinaire ne crée
aucune écriture D1 pour alimenter l’observabilité.
