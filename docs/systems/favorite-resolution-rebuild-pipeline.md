# Pipeline de reconstruction des favoris

- Version de pipeline : 2
- Contrat comportemental : `favorite-parsing-resolution-spec` v2

## Statut et portée

Ce document décrit la pipeline cible qui met en œuvre le contrat canonique
[`favorite-parsing-resolution-spec.md`](favorite-parsing-resolution-spec.md) et
l’ADR-0037. Il explique comment passer du runtime actuel à une résolution
complète sans porter les monolithes FavLib.

Il ne remplace pas la spécification des règles. La spécification décide ce
qu’un indice signifie; ce document décide où il est produit, persisté, repris,
testé et projeté.

La pipeline reste entièrement locale jusqu’aux adaptateurs de catalogue
publics. IndexedDB est la seule autorité privée. Le favori navigateur est une
observation et une commande d’import, jamais l’identité d’une œuvre ni une
autorité sur la bibliothèque ou la progression.

## État implémenté vérifié

Le runtime actuel possède déjà des fondations réutilisables :

- `WebExtensionBookmarkImportAdapter` lit l’arbre des favoris;
- `normalizeBookmarks` qualifie uniquement les URL HTTP(S);
- `importFavoriteSources` écrit `FavoriteSource` et `Review` par transactions
  de 100 entrées et conserve `importedAt` lors d’un nouvel import;
- Dexie v6 stocke les données privées dans `tobirink-private`;
- les lectures `FavoriteSource` et `Review` sont paginées et limitées à 100;
- Review limite une réponse à six candidats et son client HTTP refuse les
  réponses supérieures à 64 Kio;
- le WebBridge limite les parcours Bibliothèque à 500 œuvres, les pages à 24,
  Agenda à 100 entrées et ses enveloppes à 64 Kio;
- les modules purs `title-segmentation`, `season-extraction`,
  `progression-extraction` et `favorite-parser` produisent désormais l’artefact
  local T/I/S/R, son empreinte et toutes les preuves/rejets sans I/O;
- le background compose les ports locaux, les adaptateurs AniList et
  MangaUpdates, puis lance la convergence à l’installation, au démarrage, sur
  alarme et sur les quatre mutations de favoris;
- l’import persiste atomiquement `FavoriteSource`, `Review`, artefact et tâche;
- l’outbox IndexedDB v6 réclame les tâches dues par index composé sans
  `toArray()` global, huit au plus par tranche;
- le runner recherche, décide, hydrate par ID exact, puis écrit `Work`,
  Bibliothèque, Review et reçu de tâche dans une transaction;
- les cadences fournisseur sont sérialisées et leur `nextAllowedAt` est écrit
  dans `browser.storage.local` avant chaque effet HTTP;
- l’oracle canonique exécute réellement qualification, parser, matcher et
  projection sur les 82 identifiants synthétiques et compare leur snapshot
  profond versionné;
- une source absente est marquée `detached`; elle reste sauvegardable mais ne
  fournit plus de lien à Review, Agenda, Organisateur ou popup.

Un écart de scalabilité reste explicitement ouvert :
`WebExtensionBookmarkImportAdapter` lit encore `bookmarks.getTree()` et le
runtime reconstruit l’inventaire complet avant de le traiter par transactions
de 100. Les événements concurrents sont coalescés et provoquent une seconde
passe bornée, mais ils ne sont pas encore persistés individuellement. Les
sections « Capturer » et « Inventorier » ci-dessous décrivent donc la cible du
prochain durcissement, pas un comportement déjà livré.

## Résultat attendu

Une observation favorite converge vers exactement un des résultats suivants :

- ignorée avec une raison stable;
- importée et en attente d’une résolution durable;
- résolue vers un identifiant fournisseur unique puis hydratée par cet ID;
- envoyée à Review avec les preuves et candidats bornés;
- sans correspondance, avec une Review `no-match` et sans œuvre inventée;
- en attente d’une reprise datée après une erreur récupérable.
- bloquée avec une raison stable et un retry manuel explicite.

Chaque résultat doit être explicable depuis les données locales. Une suspension
du service worker entre deux lignes de code ne doit ni perdre l’entrée, ni
dupliquer un effet observable, ni changer la décision finale.

## Principes de reconstruction

1. Le parser est pur et ne connaît ni navigateur, ni Dexie, ni fournisseur.
2. Le brut et sa provenance sont persistés avant toute transformation réseau.
3. Une seule racine de composition background relie les ports; les surfaces
   React ne lisent jamais IndexedDB et n’appellent jamais un fournisseur.
4. Toute boucle a une tranche, un curseur et une limite explicites.
5. Toute attente dépassant le réveil courant devient `nextAttemptAt` en base.
6. Une ambiguïté échoue fermée vers Review; l’ordre ou la popularité ne tranche
   jamais.
7. Une requête d’hydratation utilise l’ID fournisseur retenu et ne rematche pas
   le titre.
8. Les migrations sont additives et les anciennes données restent lisibles.
9. Les données privées ne sont ni journalisées, ni envoyées au service public.
10. Chaque module a un oracle synthétique et un budget mesurable.
11. Le cœur suit un modèle functional-core/imperative-shell : les fonctions
    pures calculent, l’orchestrateur persiste et les adaptateurs effectuent les
    entrées-sorties.

## Flux de bout en bout

### 1. Capturer le déclencheur

Le `BookmarkEventAdapter` transforme les événements navigateur en commandes
strictes : `inventory.requested`, `favorite.observed`, `favorite.changed`,
`favorite.moved` ou `favorite.removed`. Installation, mise à jour, démarrage,
alarme de reprise et synchronisation manuelle produisent aussi une commande.

L’événement conserve l’identifiant externe, le titre brut, l’URL brute, le
chemin de dossiers et l’ordre quand ces valeurs existent. Il ne parse rien et
n’écrit aucune œuvre.

Les API WebExtension ne fournissent pas d’identifiant d’événement fiable. La
déduplication utilise donc `(bookmarkId, observationRevision)`, où la révision
est l’empreinte canonique du titre, de l’URL, du chemin, de l’ordre et de l’état
de présence. Le temps d’observation et le nom de l’événement n’y participent pas.

Les listeners sont enregistrés avant le premier inventaire. Chaque commande
reçoit dans une transaction un `observationSequence` local croissant; une
tranche d’inventaire utilise la séquence de base de sa session. Un upsert plus
ancien ne peut pas écraser un événement plus récent. Les événements accumulés
pendant le scan sont drainés avant de déclarer l’inventaire terminé.

### 2. Inventorier par tranches

L’adaptateur navigateur parcourt les dossiers avec `bookmarks.getChildren`
plutôt que de dupliquer tout `getTree()` dans un tableau aplati. Il remet au cas
d’usage au plus 100 feuilles par tranche. Un `InventoryCheckpoint` persiste la
pile de dossiers, le dernier enfant traité et l’empreinte de session avant de
rendre la main.

Il n’existe pas de plafond métier sur le nombre total de favoris. La limite de
100 protège une transaction et un réveil; les tranches suivantes continuent
jusqu’à épuisement. L’échec d’une tranche conserve les résultats déjà validés
et reprend depuis le dernier checkpoint.

Le navigateur peut malgré tout retourner tous les enfants d’un même dossier en
une seule allocation : TobiRink borne son travail et ses copies, pas cette
allocation interne non contrôlable. Le test de charge couvre donc aussi un
dossier unique très large et mesure le pic mémoire.

Une mutation d’arbre pendant l’inventaire ne rend pas la session atomique : la
séquence locale empêche les retours en arrière, puis une passe de réconciliation
relit les identifiants touchés. Une reprise après crash conserve pile, curseur,
séquence de base et liste bornée des identifiants sales.

### 3. Qualifier et établir la preuve de source

Le filtre d’éligibilité refuse les dossiers, schémas non HTTP(S), pages utilité
et entrées invalides avec un motif fermé. Les adaptateurs de source extraient
seulement les preuves propres à une origine ou une forme d’URL connue.

L’observation accepte d’abord toute chaîne URL dans ses bornes. La qualification
produit ensuite `INVALID_URL` ou `NON_WEB_URL` sans perdre ce brut; ces rejets ne
portent aucune preuve actionnable et ne peuvent donc jamais atteindre une lane
fournisseur.

La sortie `SourceEvidence` garde séparément origine, chemin, slug, identifiant
fournisseur explicite, langue, saison et indice de sortie. Une origine inconnue
reste analysable par les règles génériques sans acquérir un type média fictif.

### 4. Construire l’artefact de parsing

Le `FavoriteParser` reçoit l’observation et les preuves de source. Il normalise
le titre, arbitre identité, saison et progression puis retourne un
`FavoriteParseArtifact` immuable. L’artefact contient les valeurs brutes, les
transformations ordonnées, les fragments retenus et rejetés, leurs provenances,
les versions de règles et les motifs de blocage.

Une empreinte canonique du titre brut, de l’URL brute et des versions du parser
et de l’adaptateur de source est la clé de déduplication. `observedAt`, chemin,
ordre et type d’événement restent dans la révision d’observation et ne relancent
pas le fournisseur.
Une même empreinte produit un artefact profondément égal. Une nouvelle version
ou une entrée réellement modifiée crée une nouvelle empreinte sans écraser la
preuve précédente.

L’empreinte encode chaque chaîne en UTF-8 avec sa longueur. Le parser accepte
une observation sérialisée d’au plus 64 Kio, dont au plus 8 Kio pour le titre,
32 Kio pour l’URL et 32 segments de chemin de 512 octets chacun. Un dépassement
produit `INPUT_LIMIT_EXCEEDED`, conserve la source locale, interdit la résolution
automatique et ouvre une Review; il ne tronque jamais silencieusement le brut.

### Complexité et sûreté du parser local

Chaque étage effectue un nombre constant de parcours linéaires de son entrée.
Les URL passent par `URL` puis par leurs segments; aucune regex ne tente de
parser une URL entière. Les expressions régulières sont précompilées, ancrées
quand la règle porte sur un segment complet et interdites si elles combinent
des quantificateurs ambigus susceptibles de backtracking exponentiel.

Le nettoyage converge en cinq passes maximum. Le matcher reçoit au plus vingt
candidats et compare des chaînes déjà bornées : sa complexité ne dépend jamais
de la taille de la bibliothèque. Les tests de performance couvrent chaînes
répétitives, Unicode combiné, séparateurs nombreux, slugs de 32 Kio et vingt
candidats proches. Le budget cible est inférieur à 10 ms au p95 pour une entrée
typique de 1 Kio et à 50 ms pour l’enveloppe maximale sur le runner CI de
référence; tout changement de runner republie la baseline au lieu de masquer
une régression.

Le parser n’utilise ni DOM, ni HTML, ni Web Worker, ni cache global mutable. Il
retourne des objets gelés; l’orchestrateur est seul responsable de la
persistance et des entrées-sorties.

### 5. Importer atomiquement

Une transaction dans `tobirink-private` écrit ou met à jour `FavoriteSource`,
garantit sa `Review` et enregistre l’artefact ainsi que la première entrée de
l’outbox `ResolutionTask`. Aucun appel réseau n’a lieu avant le commit.
L’identité locale reste dérivée de l’identifiant du favori selon le contrat
actuel; `importedAt` et une décision Review existante sont préservés.

La file séparée `tobirink-durable-tasks` reste réservée aux notifications
Agenda. La résolution réutilise les fonctions pures de transition de tâche,
mais pas l’adaptateur qui empêcherait la transaction atomique avec les sources.

Une suppression navigateur marque seulement la source comme non observée ou
détachée. Elle ne supprime ni `Work`, ni progression, ni Agenda, ni décision
Review. Une purge future demanderait une action produit séparée et explicite.

### 6. Réserver et router la résolution

Le runner réclame au plus huit tâches dues et s’arrête après 20 secondes par
réveil. Le claim de 60 secondes, son expiration et l’`idempotencyKey` sont
persistés avant l’effet. Le routeur applique cet ordre :

1. identifiant fournisseur explicite et valide;
2. URL fournisseur officielle réduite localement à un identifiant public;
3. titre normalisé borné, envoyé seulement au fournisseur compatible;
4. type `UNKNOWN` routé vers les fournisseurs séparément, sans défaut manga;
5. une identité insuffisante maintient une Review `pending`; un ensemble complet
   sans correspondance produit une Review `no-match`.

AniList couvre l’anime et MangaUpdates les formats manga retenus par le contrat.
La décision fournisseur pure exécute désormais les six niveaux documentés,
après les gardes symétriques de nature, OVA, pré-sérialisation et taxonomie
exacte. Elle n'observe ni popularité, ni rang, ni ordre de réponse.
Les ports `FavoriteProviderCandidatePort` et `FavoriteProviderHydrationPort`
séparent désormais la recherche bornée de l’hydratation par référence exacte.
Leur politique versionne 20 candidats, 8 secondes de timeout, les intervalles
de 2 200/3 000 ms et les TTL 24 h/15 min sans effectuer de réseau elle-même.
Un adaptateur legacy, par exemple MangaDex, reste hors du chemin principal et
ne devient actif qu’après une décision dédiée.

Chaque fournisseur possède sa lane avec une seule requête en vol. AniList
respecte au moins 2 200 ms entre réservations et MangaUpdates 3 000 ms; leurs
lanes peuvent avancer indépendamment. Un batch d’IDs AniList contient au plus
50 identifiants. `nextAllowedAt` est persisté par fournisseur avant l’effet afin
qu’un redémarrage ne réinitialise pas la cadence. Dans une lane, les tâches dues
sont ordonnées par `(availableAt, id)`; un round-robin borné entre opérations
empêche une longue hydratation d’affamer les résolutions.

### 7. Décider sans classement implicite

Le `ProviderMatcher` pur applique les niveaux de l’ADR-0037. À chaque niveau,
un seul identifiant fournisseur distinct autorise `CERTAIN`. Zéro candidat
passe au niveau suivant; plusieurs identifiants produisent `AMBIGUOUS`.

La réponse fournisseur est ramenée à vingt candidats structurés au maximum
avant matching et porte `complete` et `truncated`. Si le fournisseur ne prouve
pas l’exhaustivité de l’ensemble pertinent, le matcher ne peut jamais produire
`CERTAIN` ou `AMBIGUOUS`; la tâche reprend ou devient `BLOCKED`. Review n’en
expose que six. Les
images, dates, rangs,
popularités et positions de réponse restent des métadonnées, jamais des
preuves d’identité.

Avant chaque niveau, `CandidateCompatibility` applique symétriquement le type,
OVA et pré-sérialisation. Le filtre éditorial de taxonomie n’intervient jamais
ici et ne peut donc pas fabriquer une identité.

### 8. Persister la décision

`CERTAIN` conserve la référence exacte dans la tâche de résolution déjà
réclamée et passe directement à son étape d’hydratation.
`AMBIGUOUS` met la Review en attente avec sa révision et les motifs.
`NO_MATCH` conserve la source et l’artefact, maintient une Review
`status = no-match` avec ses motifs et ne crée aucune `Work`.
Une décision humaine exige la révision courante et un candidat appartenant à
l’ensemble autorisé. Une décision obsolète échoue en conflit.

### 9. Hydrater par identifiant exact

L’hydratation demande la fiche par couple `(provider, externalId)`, valide une
projection bornée, puis écrit `Work` et le lien Review dans une transaction.
Elle ne relance pas une recherche de titre. Les enrichissements Agenda ou
média deviennent des tâches distinctes afin qu’un échec secondaire ne remette
pas en cause l’identité acquise.

Le mapper d’hydratation versionné normalise séparément le statut public. Le
`ContentTaxonomyPolicy` s’exécute ensuite sur les genres et catégories hydratés,
par égalité normalisée exacte; il conserve les valeurs brute et normalisée et
ne modifie jamais la décision d’identité. Les caches locaux expirent après au
plus 24 heures pour un résultat positif et 15 minutes pour une absence.

Une taxonomie bloquée ne rejoint pas la bibliothèque et n’est jamais proposée
comme candidat manuel. La Review devient `no-match` avec le diagnostic
`BLOCKED_CONTENT_TAXONOMY`; le reçu d’hydratation conserve uniquement les
libellés brut et normalisé nécessaires à l’audit local.

### 9 bis. Enrichir la langue localement

`LocalDocumentLanguageAnalyzer` est un module d’enrichissement facultatif,
séparé du parser favori. Il reçoit uniquement les déclarations et le texte d’un
document déjà observé localement après une action autorisée; il ne télécharge
pas de page. Il applique les cas `L-01…L-05`, conserve au plus 24 déclarations
de 160 caractères et refuse toute statistique sous 80 caractères nettoyés.

Sans cette preuve locale, la langue reste `undetected`. Une langue présente
dans le titre ou le slug reste un marqueur structurel. L’absence du module ne
change ni l’identité ni la progression calculées par le parser favori.

### 10. Projeter les surfaces

Les cas d’usage locaux construisent ensuite :

- Bibliothèque à partir de la bibliothèque, des `Work` et progressions locales;
- Review à partir des entrées pending et de leurs preuves;
- Agenda à partir des entrées locales dans la semaine demandée;
- WebBridge à partir de ces projections sérialisées et validées.

Une `Work` absente produit un état partiel. Une lecture UI ne déclenche aucun
réseau et ne remplace aucune donnée manquante par une fixture.

### 11. Réconcilier et reprendre

Au démarrage et sur alarme, le runner libère les claims expirés, exécute les
tâches dues et programme le prochain réveil. Une réconciliation locale trouve
par pages les sources sans artefact courant, artefacts sans tâche terminale et
décisions résolues sans hydratation complète. Elle crée uniquement les tâches
manquantes avec leurs clés idempotentes.

Les lectures utilisent `idempotencyKey` unique, l’index composé
`[kind+lane+state+availableAt]` pour les tâches dues et
`[state+claimExpiresAt]` pour les claims expirés. Aucun runner ne charge toute
la file avec `toArray()` et chaque lane réclame seulement ses propres types.
Chaque tâche possède toujours `availableAt`, y compris `READY`, afin que la
requête composée reste indexable sans branche de scan.

## Contrats possédés

| Contrat | Champs indispensables | Producteur | Consommateur |
| --- | --- | --- | --- |
| `FavoriteObservation` | ID externe, brut, chemin, ordre, présence, révision et séquence locale | adaptateur navigateur | qualification |
| `SourceEvidence` | disposition URL, indices, provenance, motifs de rejet | adaptateur de source | parser |
| `FavoriteParseArtifact` | brut, transformations, identité, saison, progression, versions, empreinte | parser pur | import et resolver |
| `ResolutionTask` | ID, artefact, état, tentative, échéance, claim, clé idempotente | import/réconciliation | runner |
| `ResolutionDecision` | `CERTAIN`, `AMBIGUOUS` ou `NO_MATCH`, niveau, références, motifs | matcher pur | persistance/Review |
| `ProviderCandidateEnvelope` | candidats normalisés, fournisseur, curseur, `complete`, `truncated`, digest | adaptateur fournisseur | matcher pur |
| `ProviderRateCheckpoint` | fournisseur et `nextAllowedAt` | rate gate | lane fournisseur |
| Étape d’hydratation | fournisseur et ID exact issus de la décision | runner réclamé | adaptateur fournisseur |
| `LocalLanguageEvidence` | déclarations bornées, statistique, conflits et provenance | analyseur local facultatif | enrichissement local |
| `FavoriteProjection` | IDs locaux, statut, données locales disponibles, état partiel | application | extension et WebBridge |

Tous les contrats sont validés aux frontières. Les types du domaine ne
contiennent pas `Response`, `browser.*`, `Dexie`, temporisateur ou variable WXT.

## Frontières de modules cibles

| Propriétaire | Responsabilité | Dépendances permises |
| --- | --- | --- |
| `packages/domain` | artefacts, preuves, décisions et invariants purs | aucune infrastructure |
| `packages/application` | qualification, parsing, matching, import, runner, réconciliation et ports | domaine et contrats possédés |
| `packages/adapters-browser` | événements favoris, preuves URL, transports publics injectés | ports application et API injectées |
| `packages/adapters-indexeddb` | transactions, stores, index, claims et migrations | ports application et Dexie |
| `apps/extension/wxt-entrypoints/background.ts` | composition et routage de messages uniquement | cas d’usage et adaptateurs |
| `packages/ui`, surfaces extension et web | rendu de projections et commandes explicites | contrats sérialisés, jamais le stockage |

La racine background ne contient aucune regex métier, heuristique de matching,
boucle de scan ou politique de retry. Elle construit les adaptateurs et appelle
un coordinateur.

À l’intérieur de `packages/application/src/favorites`, les modules restent
physiquement séparés : `eligibility`, `source-evidence`, `title-normalization`,
`identity`, `season`, `progress`, `parse-artifact`, `candidate-compatibility`,
`provider-matcher`, `resolution-outbox`, `resolver-runner`, `hydration` et
`projection`. Un `FavoriteParser` éventuel ne fait que composer les fonctions
pures; il ne contient aucune règle supplémentaire.

Chaque fournisseur sépare aussi `query-builder`, `transport`, `response-decoder`,
`candidate-mapper`, `hydration-mapper`, `cache` et `rate-gate`. Les adaptateurs
de source utilisent une table d’origines exactes et un seul fallback générique.
Zéro adaptateur produit la preuve générique; plusieurs adaptateurs applicables
produisent `SOURCE_ADAPTER_CONFLICT`. Aucun ordre de registre et aucun switch
central ne décide silencieusement entre deux analyses.

### Traçabilité complète des 82 cas

| Famille | Module propriétaire | Gate |
| --- | --- | --- |
| `P-01…P-08` | normalisation et matcher | oracle d’artefact et décision |
| `L-01…L-05` | analyseur de langue local facultatif | oracle d’enrichissement |
| `F-01…F-02` | compatibilité candidat | oracle de décision |
| `C-01…C-02` | taxonomie post-hydratation | oracle de projection |
| `X-01…X-02` | adaptateur MangaDex futur et garde de progression commune | `X-01` exclu, `X-02` commun testé |
| `U-01…U-10` | éligibilité et preuves URL | oracle d’artefact |
| `T-01…T-10` | segmentation et nettoyage du titre | oracle d’artefact |
| `I-01…I-07` | construction d’identité | oracle d’artefact |
| `S-01…S-07` | saison | oracle d’artefact |
| `R-01…R-14` | progression | oracle d’artefact |
| `Q-01…Q-08` | outbox, scheduler et consentement | tests de suspension/concurrence |
| `B-01…B-05` | événements et inventaire | tests WebExtension |
| `O-01…O-02` | corpus synthétique | gate d’équivalence |

## Fiche d’exécution par composant

| Composant | Entrée → sortie | Limite | Échec et reprise | Idempotence | Preuve minimale |
| --- | --- | --- | --- | --- | --- |
| Capture d’événement | événement API → commande | 1 événement, 64 Kio | valeur invalide en Review avec motif | bookmark ID + révision d’observation | tests des 4 événements et installation |
| Inventaire | enfants de dossier → tranches d’observations | 100 feuilles/tranche | checkpoint puis reprise | session + pile + curseur | grand arbre, dossier unique large, suspension |
| Qualification | observation → admissible/rejet | 1 | fail-closed | fonction pure | cas U-08/U-09/U-10 |
| Preuve URL | admissible → `SourceEvidence` | 32 preuves, 16 aliases | preuve générique ou rejet | fonction pure | U-01 à U-07 |
| Parser | brut + preuves → artefact | 64 Kio, 64 transformations, 32 diagnostics | motif stable, aucune exception opaque | empreinte sémantique | matrice P à R + oracle profond |
| Import | artefact → source, Review, tâche | 100/transaction | rollback transactionnel | IDs source/review + empreinte | relecture et décision existante |
| Claim | tâches dues → tâches réservées | 8/20 s, claim 60 s | expiration durable | clé unique d’effet | deux workers, lanes isolées, claim expiré |
| Transport | requête publique → enveloppe complète | 20 candidats, 64 Kio, 8 s | tronqué fail-closed, erreur typée | clé tâche + requête | timeout, 403, 429, JSON invalide, page manquante |
| Matcher | artefact + candidats → décision | 20 | ambiguïté explicite | fonction pure | permutations et égalités |
| Review | décision → choix confirmé | 6 candidats, 100 pending | conflit de révision | review + révision + choix | stale, skip, no-match, resolve |
| Hydratation | ID exact → `Work` | 1 fiche, 64 Kio, 8 s | retry sans rematch | fournisseur + ID + version | replay après commit réseau |
| Langue locale | document déjà observé → preuve | 24 déclarations, 160 caractères, texte ≥ 80 | `undetected` ou `ambiguous` | entrée + version analyseur | L-01 à L-05 |
| Taxonomie | fiche hydratée → admissible/bloquée | listes fermées versionnées | blocage éditorial explicite | fiche + version politique | C-01/C-02 |
| Projection | stores → snapshot UI | 24/500/100, 64 Kio | état partiel | lecture pure | limites, données manquantes, vide |
| Réconciliation | pages locales → tâches manquantes | 100/page, 8 créées/réveil | curseur durable | index uniques | interruption à chaque checkpoint |

Les limites nouvelles sont normatives : 8 secondes par requête, 20 candidats,
8 tâches et 20 secondes par réveil, claim de 60 secondes, huit tentatives,
backoff de 30 secondes à 6 heures, AniList 2 200 ms, MangaUpdates 3 000 ms et
batch AniList de 50. Les limites déjà actives de 100, 6, 24, 500 et 64 Kio ne
doivent pas être dupliquées sous forme de constantes concurrentes.

L’outbox conserve l’artefact courant et au plus son prédécesseur par source;
un artefact référencé par une Review ouverte ou une tâche non terminale est
épinglé. Après 30 jours, une tâche `COMMITTED` est remplacée atomiquement par
l’unique `ResolutionReceipt` courant de son couple `(sourceId, operation)` :
`idempotencyKey`, `completedAt`, versions et `effectDigest`. Le nombre de reçus
reste donc proportionnel aux sources, pas aux événements historiques. Cette
compaction ne supprime aucune source, Review, œuvre ou progression et garde la
preuve nécessaire à la déduplication. Les candidats complets ne sont pas
archivés : seuls les six candidats d’une Review active et le digest de réponse
sont conservés.

## Machine d’état durable

Une tâche suit uniquement les transitions suivantes :

`READY → CLAIMED → EFFECT_RECORDED → COMMITTED`

Depuis `CLAIMED`, une erreur récupérable mène à `RETRY_AT`. Une erreur de
contrat, un consentement absent ou huit tentatives automatiques mène à
`BLOCKED`. Un claim expiré retourne à `READY` avec la même clé idempotente.

- `READY` : entrée complète, aucun effet réservé;
- `CLAIMED` : propriétaire et expiration persistés;
- `EFFECT_RECORDED` : réponse validée ou résultat déterministe persisté;
- `COMMITTED` : projection autoritaire mise à jour;
- `RETRY_AT` : échéance absolue persistée, aucun `setTimeout` long;
- `BLOCKED` : raison stable, visible au diagnostic local, reprise explicite.

Le réseau est au-moins-une-fois. L’écriture locale est exactement-une-fois du
point de vue métier grâce aux clés uniques, révisions et upserts transactionnels.

## Politique d’erreur

| Condition | Décision | Reprise |
| --- | --- | --- |
| URL invalide ou non HTTP(S) | ignorée avec motif | nouvelle observation seulement |
| identité manquante ou opaque | Review ou `NO_MATCH` selon le contrat | décision humaine ou nouvelle preuve |
| plusieurs identités au même niveau | `AMBIGUOUS` | Review, jamais premier résultat |
| 429 | tâche `RETRY_AT` | `Retry-After` ou rate reset validé, sinon 60 s |
| 403 fournisseur | indisponibilité longue | nouvelle tentative au plus tôt dans 1 h |
| timeout, offline, 5xx | erreur récupérable | backoff borné avec échéance persistée |
| ensemble candidat incomplet ou tronqué | jamais `CERTAIN` ni `AMBIGUOUS` | page suivante, retry puis `BLOCKED` |
| JSON, type ou taille invalide | erreur de contrat | tentatives bornées puis `BLOCKED` |
| version parser obsolète | reparse local | nouvelle empreinte et invalidation ciblée |
| Review révisée pendant une décision | conflit | relecture de la Review |
| `Work` absente | projection partielle | hydratation/réconciliation dédiée |
| quota ou migration IndexedDB | aucune remise à zéro | ancienne version conservée, erreur récupérable |

Le jitter de retry est calculé une fois puis persisté pour rendre les tests et
les réveils déterministes. Les messages UI restent stables et n’exposent ni
stack, ni titre privé, ni URL privée.

## Scénarios opérationnels

### Première installation — cible après durcissement d’inventaire

Le background ouvre Dexie, crée une session d’inventaire par dossiers, traite
les tranches, importe chaque source et laisse la file reprendre la résolution. L’UI peut
afficher séparément import en cours, bibliothèque vide réelle et Review en
attente. Elle ne prétend pas que l’analyse est terminée avant le dernier
checkpoint.

### Modification ou déplacement — cible après durcissement d’inventaire

L’événement relit seulement le favori concerné. Un titre, une URL, un chemin ou
un ordre modifié met à jour la source. Seule une modification qui change
l’empreinte de parsing invalide la résolution automatique; un déplacement de
dossier ne relance pas un fournisseur.

### Suppression navigateur

La source est marquée détachée après vérification de l’événement. La bibliothèque
et la progression restent intactes. Une réapparition avec le même identifiant
réactive la source sans perdre l’historique.

### Suspension et mode hors ligne

Chaque étape reprend depuis IndexedDB. Hors ligne, aucune donnée autoritaire
n’est effacée et les tâches réseau reçoivent une échéance. Le runner s’arrête
après son lot, programme une alarme et libère le service worker.

### Retry manuel

L’action cible une tâche `BLOCKED` ou une Review précise, incrémente sa révision
et recrée une tentative avec la même entrée. Elle ne déclenche pas un scan
global et ne contourne pas le consentement.

## Migration depuis Dexie v5

La version Dexie v6 est additive au-dessus de v5 dans `tobirink-private`, avec
`favoriteArtifacts` et `favoriteResolutionTasks`. La tâche porte la lane
`routing`, une clé d’idempotence unique et l’index composé défini plus haut.
Source, Review, artefact et première tâche `READY` sont écrits dans la même
transaction. Aucun store existant n’est supprimé ou renommé. Le checkpoint
d’inventaire reste une étape ultérieure; la base séparée des notifications
n’est ni migrée ni utilisée par le resolver.

| Store | Index nécessaires |
| --- | --- |
| `favoriteSources` | index existants, puis `observationSequence`, `semanticFingerprint`, `[presence+id]` |
| `favoriteArtifacts` | `&sourceId`, `reviewId`, `recordedAt`, `artifact.semanticFingerprint` |
| `favoriteResolutionTasks` | `&id`, `&idempotencyKey`, `kind`, `lane`, `state`, `availableAt`, `[kind+lane+state+availableAt]` |
| `resolutionReceipts` | `&[sourceId+operation]`, `&idempotencyKey` |
| `inventoryCheckpoints` | `&id`, `status`, `baseSequence` |
| `providerRateCheckpoints` | `&provider`, `nextAllowedAt` |

Les index composés ne contiennent aucune valeur optionnelle sur leur chemin de
lecture : `provider`, `availableAt`, `claimExpiresAt` et `presence` reçoivent
des sentinelles contractuelles quand leur état n’a pas de valeur métier. Les
requêtes ajoutent toujours une `limit`; leur coût est testé avec 10 000 tâches
terminales et un petit ensemble dû.

Le backfill :

1. pagine les `FavoriteSource` par ID, 100 à la fois;
2. construit l’artefact avec la version courante sans réseau;
3. relie la `Review` existante sans réinitialiser son statut;
4. crée une tâche seulement si la source n’a pas de résultat terminal cohérent;
5. persiste le curseur après chaque transaction;
6. garde les enregistrements v5 lisibles pendant toute la convergence.

Un échec arrête le nouveau runner et conserve l’ancienne base; il n’appelle
jamais `delete()` ou `clear()`. Le rollback applicatif désactive le coordinateur
et continue de lire `FavoriteSource`, `Review` et `Work`. La suppression future
des champs de compatibilité exige une autre ADR après mesure de migration.

## Améliorations apportées

| Défaut observé dans l’ancien empilement | Reconstruction | Preuve d’amélioration |
| --- | --- | --- |
| parser dense avec responsabilités mêlées | qualification, preuves, titre, saison, progression et artefact séparés | tests unitaires par frontière + oracle complet |
| metadata mêlant HTTP, HTML, sécurité et mapping | ports fournisseur étroits et projections validées | aucun import réseau dans domaine/application |
| background portant les règles | racine de composition mince | test structurel et Sensor |
| helpers concurrents | un seul artefact canonique versionné | égalité profonde du corpus |
| arbre complet aplati en mémoire | parcours `getChildren`, tranches et checkpoint | grand inventaire repris après suspension |
| import seulement à l’installation | quatre événements + réconciliation | tests création/changement/déplacement/suppression |
| favori traité comme autorité | commande d’import vers IndexedDB | suppression sans cascade |
| type manga par défaut | `UNKNOWN` jusqu’à une preuve | U-02 et routage séparé |
| protocole ou origine réécrits | URL brute préservée | U-10 |
| premier résultat ou popularité | unicité par niveau | permutations sans changement de décision |
| attentes longues en mémoire | `nextAttemptAt` et alarme | suspension à chaque checkpoint |
| effets potentiellement dupliqués | claim, empreinte et clé idempotente | course entre deux réveils |
| file générique scannée avec `toArray()` | outbox atomique et claims par index/lanes | coût du claim indépendant de la taille totale |
| ensemble fournisseur tronqué | `complete`/`truncated` interdit un faux `CERTAIN` | candidat compatible caché après la limite |
| données brutes perdues | artefact immuable avec provenance | audit de chaque transformation |
| no-match masqué | Review ou `NO_MATCH` explicite | états UI et motifs stables |
| hydratation couplée au matching | tâche par ID exact | replay sans recherche de titre |

## Vie privée, sécurité et observabilité

- l’URL brute, le titre brut, le chemin de dossier et l’historique restent en
  IndexedDB;
- une URL fournisseur explicite est réduite localement à un ID public;
- une recherche par titre envoie seulement le titre normalisé nécessaire au
  fournisseur sélectionné, jamais l’URL ou le chemin du favori;
- les origines HTTPS, redirections, content types, délais, octets et schémas de
  réponse sont contrôlés par l’adaptateur;
- aucun log ne contient d’entrée brute, de candidat privé ou de contenu de
  Review;
- les métriques par défaut sont locales : compte par état, durée par étape,
  profondeur de file, âge du plus vieux retry, motifs agrégés et migrations;
- une contribution collective reste opt-in, révocable et séparée de la
  résolution automatique conformément à l’ADR-0033.

## Ordre de livraison

Chaque vague est un pas fonctionnel indépendant, migré, testé et committé.

1. **Contrats et corpus** — types possédés, vocabulaires fermés, fixtures
   synthétiques, oracle profond des 77 conservations, quatre corrections et
   `X-01` futur; aucun runtime activé.
2. **Parser pur** — qualification, preuves génériques, normalisation, identité,
   saison, progression et artefact; matrice P/U/T/I/S/R verte.
3. **Adaptateurs de source** — règles URL isolées, langue locale facultative,
   compatibilité format et tests de provenance; aucune permission ou requête
   réseau.
4. **Stockage durable** — migration additive, tâches, claims, checkpoints et
   backfill borné; tests Chromium de v1 à la nouvelle version.
5. **Resolver désactivé** — lanes, transports injectés, complétude et matcher
   derrière un port non composé; tests 429/403/timeout/taille/troncature/
   permutation.
6. **Coordinateur background** — inventaire par tranches, événements favoris,
   runner et alarmes; tests de suspension et de concurrence.
7. **Hydratation et projections** — ID exact, `Work`, Bibliothèque, Agenda et
   WebBridge partiels; aucune lecture UI ne déclenche le réseau.
8. **Review et durcissement** — décisions révisées, retries manuels,
   observabilité locale, scénarios navigateurs et budgets de performance.

L’activation d’un fournisseur, l’ajout d’une permission hôte, une mutation
Cloudflare ou un déploiement restent des opérations séparément approuvées.

## Matrice d’acceptation de la pipeline

- **Inventaire** : 0, 1, 100, 101 et plusieurs milliers d’entrées; reprise à
  chaque frontière; aucun favori perdu.
- **Événements** : création, modification, déplacement et suppression; ordre
  inversé, doublon, rediffusion et événement pendant inventaire donnent le même
  état final; une tranche ancienne ne remplace jamais une observation récente.
- **Parsing** : les 82 cas de la spécification et l’artefact complet restent
  déterministes; 77 résultats sont conservés, quatre sont corrigés et `X-01`
  reste hors gate tant que son adaptateur est absent.
- **Résolution** : ID explicite, URL officielle, titre exact, saison, mots
  réordonnés, distance bornée, égalité et no-match.
- **Fournisseurs** : timeout, offline, 403, 429, 5xx, mauvaise origine,
  redirection, mauvais type, JSON invalide, plus de 64 Kio, ensemble incomplet
  ou trop de candidats; aucun cas tronqué ne produit `CERTAIN`.
- **Durabilité** : suspension avant/après claim, réponse, décision, hydratation
  et commit; claim expiré et deux runners concurrents.
- **Migration** : v1, v2, v3, v4 et v5 conservent œuvres, sources, Reviews,
  progression, Agenda et organisateur; backfill interrompu puis repris.
- **UI** : import en cours, vide réel, Review, partiel, hors ligne, retry et
  erreur récupérable sans contenu fictif.
- **Sécurité** : aucune donnée privée dans URL publique, log, fixture ou
  télémétrie; aucun réseau depuis les surfaces.
- **Performance** : aucun scan illimité, transaction au plus 100, huit tâches
  et 20 secondes par réveil, claims indexés sans `toArray()` global, réponses à
  temps borné, compaction et taille de bundle surveillée.
- **Protections supplémentaires** : 64 Kio puis 64 Kio + 1 pour l’observation,
  candidat compatible masqué après la limite, rollback des quatre écritures de
  l’outbox, 10 000 tâches terminales sans scan global et compaction/reprise du
  reçu technique.

## Portes de vérification des futures vagues

Chaque vague exécute ses tests ciblés puis, avant commit :

```text
npm run typecheck
npm run test:domain
npm run test:contracts
npm run test:storage
npm run test:migrations
npm run test:security
npm run test:performance
npm run lint
npm run lint:anti-slop
npm run sensor -- .project/progress.json docs/architecture/src/favorite-resolution.dataflow.json
npm run archify:validate -- dataflow
npm run archify:validate -- all
git diff --check
```

Les commandes non pertinentes à une vague peuvent rester hors de son test
ciblé, mais `npm run verify` devient obligatoire avant l’activation complète.

## Définition de terminé

La reconstruction est terminée seulement quand :

- tout événement favori atteint un état terminal ou une reprise datée;
- chaque transformation est visible dans un artefact local versionné;
- le parser et le matcher sont purs et couverts par la matrice canonique;
- l’oracle prouve 77 conservations, quatre corrections et l’exclusion de
  `X-01`, sans réponse fournisseur vivante;
- l’inventaire, les fournisseurs et les projections respectent leurs bornes;
- une suspension à n’importe quel checkpoint converge sans doublon métier;
- les migrations préservent toutes les données v1 à v5 sans remise à zéro;
- l’outbox partage la transaction des sources et ne scanne jamais toute la file;
- Review expose toutes les ambiguïtés et aucune sélection implicite;
- les surfaces ne lisent que les projections locales validées;
- les tests navigateurs prouvent installation, reprise, événements et hors
  ligne;
- `npm run verify` et Archify showcase passent sans erreur ni avertissement.

Ne sont pas inclus : copie de code ou de données FavLib, scraping HTML,
activation silencieuse d’un fournisseur, synchronisation privée cloud,
suppression automatique d’œuvres, publication ou déploiement.
