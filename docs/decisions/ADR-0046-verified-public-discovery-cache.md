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
- Revised: 2026-09-15
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

Le consumer reçoit jusqu’à vingt signaux à la fois mais exécute un seul
`claim(20)` par lot; chaque résultat vérifié est publié dès sa disponibilité.
Après le lot, une lecture des demandes restantes conserve une continuation
Queue retardée de 1 à 900 secondes, même après un claim vide. L’échec de cet
envoi conserve le signal entrant par retry. Le claim ordonne
les demandes par référence fournisseur exacte, média précis, puis recherche
ambiguë, avant l’ancienneté et l’empreinte.

Le composant portable de l’ADR-0047 lit les demandes v3 en attente via une source
injectée. Il route la recherche vers AniList, MangaUpdates, MangaDex, Kitsu
Anime ou Kitsu Manga selon le type média, applique le matcher versionné, puis
hydrate l’identifiant exact retenu. Il produit exactement un résultat
`VERIFIED`, `NOT_FOUND` ou `AMBIGUOUS`; une panne, un 403, un 429, une réponse
incomplète ou un timeout reste `PENDING` avec une reprise bornée. Le Worker
conditionne chaque publication au bail et au digest courants; il demeure
l’unique auteur des tables publiques fiables.

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
réarme cette demande. Le POST d’admission ordinaire conserve aussi cet état et
ses tentatives : une resoumission de transport ne constitue pas une autorisation
de réinitialisation. Une intervention opérationnelle distincte est nécessaire.

Le client conserve dans `storage.local` une cadence commune aux admissions et
refreshs, avec au moins 6,5 secondes entre deux réservations. La limite serveur
reste 10/minute. Un `429` expose `Retry-After`, conservé après redémarrage.
Une échéance PENDING durable empêche qu’une lecture repousse indéfiniment sa
resoumission. Chaque HTTP expire au plus tard après 15 secondes, corps compris,
ou à l’échéance du réveil si elle arrive avant. Au moins une seconde restante
est requise pour commencer; exiger quinze secondes disponibles provoquait une
attente perpétuelle après une préparation dépassant cinq secondes.
Attente serveur, admission, quota,
réseau, timeout, indisponibilité, conflit et réponse invalide restent distincts.
Les attentes et indisponibilités transitoires ne consomment pas de tentative
locale; les erreurs de contrat restent actionnables et bornées.

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

Au plus 5 000 demandes peuvent être simultanément `PENDING` ou `PROCESSING`.
Une nouvelle clé au-delà de cette borne reçoit `503`; une clé existante reste
lisible et rejouable. Après terminalisation, `request_json` devient `{}` et le
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
