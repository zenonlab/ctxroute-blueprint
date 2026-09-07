# Pipeline de reconstruction des favoris

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

## État de départ vérifié

Le runtime actuel possède déjà des fondations réutilisables :

- `WebExtensionBookmarkImportAdapter` lit l’arbre des favoris;
- `normalizeBookmarks` qualifie uniquement les URL HTTP(S);
- `importFavoriteSources` écrit `FavoriteSource` et `Review` par transactions
  de 100 entrées et conserve `importedAt` lors d’un nouvel import;
- Dexie v5 stocke les données privées dans `tobirink-private`;
- les lectures `FavoriteSource` et `Review` sont paginées et limitées à 100;
- Review limite une réponse à six candidats et son client HTTP refuse les
  réponses supérieures à 64 Kio;
- le WebBridge limite les parcours Bibliothèque à 500 œuvres, les pages à 24,
  Agenda à 100 entrées et ses enveloppes à 64 Kio;
- le background compose les ports locaux et lance l’import à l’installation ou
  à la mise à jour.

Ce chemin n’est pas encore une pipeline de résolution complète : l’inventaire
est aplati en mémoire, les événements `bookmarks.onCreated`, `onChanged`,
`onMoved` et `onRemoved` ne convergent pas individuellement, aucun artefact de
parsing n’est persisté et aucun runner durable ne compose parsing, recherche,
décision puis hydratation. `resolveFavorite` existe comme cas d’usage isolé,
mais ne constitue pas encore le chemin du background installé. Il dérive aussi
un identifiant Review différemment de l’import : la reconstruction doit toujours
réutiliser le `reviewId` porté par `FavoriteSource` et supprimer cette seconde
source d’identité.

## Résultat attendu

Une observation favorite converge vers exactement un des résultats suivants :

- ignorée avec une raison stable;
- importée et en attente d’une résolution durable;
- résolue vers un identifiant fournisseur unique puis hydratée par cet ID;
- envoyée à Review avec les preuves et candidats bornés;
- sans correspondance, sans œuvre inventée;
- en attente d’une reprise datée après une erreur récupérable.

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

## Flux de bout en bout

### 1. Capturer le déclencheur

Le `BookmarkEventAdapter` transforme les événements navigateur en commandes
strictes : `inventory.requested`, `favorite.observed`, `favorite.changed`,
`favorite.moved` ou `favorite.removed`. Installation, mise à jour, démarrage,
alarme de reprise et synchronisation manuelle produisent aussi une commande.

L’événement conserve l’identifiant externe, le titre brut, l’URL brute, le
chemin de dossiers et l’ordre quand ces valeurs existent. Il ne parse rien et
n’écrit aucune œuvre.

### 2. Inventorier par tranches

L’adaptateur navigateur parcourt l’arbre avec un itérateur et remet au cas
d’usage au plus 100 feuilles par tranche. Un `InventoryCheckpoint` persiste le
curseur de parcours et l’empreinte de session avant de rendre la main.

Il n’existe pas de plafond métier sur le nombre total de favoris. La limite de
100 protège une transaction et un réveil; les tranches suivantes continuent
jusqu’à épuisement. L’échec d’une tranche conserve les résultats déjà validés
et reprend depuis le dernier checkpoint.

### 3. Qualifier et établir la preuve de source

Le filtre d’éligibilité refuse les dossiers, schémas non HTTP(S), pages utilité
et entrées invalides avec un motif fermé. Les adaptateurs de source extraient
seulement les preuves propres à une origine ou une forme d’URL connue.

La sortie `SourceEvidence` garde séparément origine, chemin, slug, identifiant
fournisseur explicite, langue, saison et indice de sortie. Une origine inconnue
reste analysable par les règles génériques sans acquérir un type média fictif.

### 4. Construire l’artefact de parsing

Le `FavoriteParser` reçoit l’observation et les preuves de source. Il normalise
le titre, arbitre identité, saison et progression puis retourne un
`FavoriteParseArtifact` immuable. L’artefact contient les valeurs brutes, les
transformations ordonnées, les fragments retenus et rejetés, leurs provenances,
les versions de règles et les motifs de blocage.

Une empreinte canonique de l’entrée et des versions est la clé de déduplication.
Une même empreinte produit un artefact profondément égal. Une nouvelle version
ou une entrée réellement modifiée crée une nouvelle empreinte sans écraser la
preuve précédente.

### 5. Importer atomiquement

Une transaction écrit ou met à jour `FavoriteSource`, garantit sa `Review` et
enregistre l’artefact ainsi que la première `ResolutionTask`. Aucun appel réseau
n’a lieu avant le commit. L’identité locale reste dérivée de l’identifiant du
favori selon le contrat actuel; `importedAt` et une décision Review existante
sont préservés.

Une suppression navigateur marque seulement la source comme non observée ou
détachée. Elle ne supprime ni `Work`, ni progression, ni Agenda, ni décision
Review. Une purge future demanderait une action produit séparée et explicite.

### 6. Réserver et router la résolution

Le runner réclame au plus huit tâches dues par réveil. Le claim, son expiration
et l’`idempotencyKey` sont persistés avant l’effet. Le routeur applique cet
ordre :

1. identifiant fournisseur explicite et valide;
2. URL fournisseur officielle réduite localement à un identifiant public;
3. titre normalisé borné, envoyé seulement au fournisseur compatible;
4. type `UNKNOWN` routé vers les fournisseurs séparément, sans défaut manga;
5. aucun fournisseur admissible produit `NO_MATCH` ou Review selon les preuves.

AniList couvre l’anime et MangaUpdates les formats manga retenus par le contrat.
Un adaptateur legacy, par exemple MangaDex, reste hors du chemin principal et
ne devient actif qu’après une décision dédiée.

### 7. Décider sans classement implicite

Le `ProviderMatcher` pur applique les niveaux de l’ADR-0037. À chaque niveau,
un seul identifiant fournisseur distinct autorise `CERTAIN`. Zéro candidat
passe au niveau suivant; plusieurs identifiants produisent `AMBIGUOUS`.

La réponse fournisseur est ramenée à vingt candidats structurés au maximum
avant matching. Review n’en expose que six. Les images, dates, rangs,
popularités et positions de réponse restent des métadonnées, jamais des
preuves d’identité.

### 8. Persister la décision

`CERTAIN` enregistre la référence exacte et planifie une `HydrationTask`.
`AMBIGUOUS` met la Review en attente avec sa révision et les motifs.
`NO_MATCH` conserve la source et l’artefact sans créer de `Work`.
Une décision humaine exige la révision courante et un candidat appartenant à
l’ensemble autorisé. Une décision obsolète échoue en conflit.

### 9. Hydrater par identifiant exact

L’hydratation demande la fiche par couple `(provider, externalId)`, valide une
projection bornée, puis écrit `Work` et le lien Review dans une transaction.
Elle ne relance pas une recherche de titre. Les enrichissements Agenda ou
média deviennent des tâches distinctes afin qu’un échec secondaire ne remette
pas en cause l’identité acquise.

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

## Contrats possédés

| Contrat | Champs indispensables | Producteur | Consommateur |
| --- | --- | --- | --- |
| `FavoriteObservation` | ID externe, brut, chemin, ordre, type d’événement, instant | adaptateur navigateur | qualification |
| `SourceEvidence` | disposition URL, indices, provenance, motifs de rejet | adaptateur de source | parser |
| `FavoriteParseArtifact` | brut, transformations, identité, saison, progression, versions, empreinte | parser pur | import et resolver |
| `ResolutionTask` | ID, artefact, état, tentative, échéance, claim, clé idempotente | import/réconciliation | runner |
| `ResolutionDecision` | `CERTAIN`, `AMBIGUOUS` ou `NO_MATCH`, niveau, références, motifs | matcher pur | persistance/Review |
| `HydrationTask` | fournisseur, ID exact, révision, état de reprise | décision certaine | adaptateur fournisseur |
| `FavoriteProjection` | IDs locaux, statut, données locales disponibles, état partiel | application | extension et WebBridge |

Tous les contrats sont validés aux frontières. Les types du domaine ne
contiennent pas `Response`, `browser.*`, `Dexie`, temporisateur ou variable WXT.

## Frontières de modules cibles

| Propriétaire | Responsabilité | Dépendances permises |
| --- | --- | --- |
| `packages/domain` | artefacts, preuves, décisions et invariants purs | aucune infrastructure |
| `packages/application` | qualification, parsing, matching, import, runner, réconciliation et ports | domaine et contrats possédés |
| `packages/adapters-browser` | événements favoris, preuves URL, transports publics injectés | ports application et API injectées |
| `packages/adapters-indexeddb` | transactions, stores, index, claims, checkpoints et migrations | ports application et Dexie |
| `apps/extension/wxt-entrypoints/background.ts` | composition et routage de messages uniquement | cas d’usage et adaptateurs |
| `packages/ui`, surfaces extension et web | rendu de projections et commandes explicites | contrats sérialisés, jamais le stockage |

La racine background ne contient aucune regex métier, heuristique de matching,
boucle de scan ou politique de retry. Elle construit les adaptateurs et appelle
un coordinateur.

## Fiche d’exécution par composant

| Composant | Entrée → sortie | Limite | Échec et reprise | Idempotence | Preuve minimale |
| --- | --- | --- | --- | --- | --- |
| Capture d’événement | événement API → commande | 1 événement | valeur invalide ignorée avec motif | ID événement + révision | tests des 4 événements et installation |
| Inventaire | arbre → tranches d’observations | 100 feuilles/tranche | checkpoint puis reprise | session + curseur | grand arbre, dossier profond, suspension |
| Qualification | observation → admissible/rejet | 1 | fail-closed | fonction pure | cas U-08/U-09/U-10 |
| Preuve URL | admissible → `SourceEvidence` | longueur contractuelle | preuve générique ou rejet | fonction pure | U-01 à U-07 |
| Parser | brut + preuves → artefact | 1 artefact borné | motif stable, aucune exception opaque | empreinte entrée/versions | matrice P à R + oracle profond |
| Import | artefact → source, Review, tâche | 100/transaction | rollback transactionnel | IDs source/review + empreinte | relecture et décision existante |
| Claim | tâches dues → tâches réservées | 8/réveil | expiration durable | clé unique d’effet | deux workers, claim expiré |
| Transport | requête publique → candidats | 20 candidats, 64 Kio, 8 s | erreur typée et échéance | clé tâche + requête | timeout, 403, 429, JSON invalide |
| Matcher | artefact + candidats → décision | 20 | ambiguïté explicite | fonction pure | permutations et égalités |
| Review | décision → choix confirmé | 6 candidats, 100 pending | conflit de révision | review + révision + choix | stale, skip, no-match, resolve |
| Hydratation | ID exact → `Work` | 1 fiche, 64 Kio, 8 s | retry sans rematch | fournisseur + ID + version | replay après commit réseau |
| Projection | stores → snapshot UI | 24/500/100, 64 Kio | état partiel | lecture pure | limites, données manquantes, vide |
| Réconciliation | pages locales → tâches manquantes | 100/page, 8 créées/réveil | curseur durable | index uniques | interruption à chaque checkpoint |

Les limites nouvelles de 8 secondes, 20 candidats et 8 tâches par réveil sont
des budgets cibles à matérialiser dans les contrats et tests de leur étape de
code. Les limites déjà actives de 100, 6, 24, 500 et 64 Kio ne doivent pas être
dupliquées sous forme de constantes concurrentes.

## Machine d’état durable

Une tâche suit uniquement les transitions suivantes :

`READY → CLAIMED → EFFECT_RECORDED → COMMITTED`

Depuis `CLAIMED`, une erreur récupérable mène à `RETRY_AT`. Une erreur de
contrat, un consentement absent ou un nombre maximal de tentatives mène à
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
| JSON, type ou taille invalide | erreur de contrat | tentatives bornées puis `BLOCKED` |
| version parser obsolète | reparse local | nouvelle empreinte et invalidation ciblée |
| Review révisée pendant une décision | conflit | relecture de la Review |
| `Work` absente | projection partielle | hydratation/réconciliation dédiée |
| quota ou migration IndexedDB | aucune remise à zéro | ancienne version conservée, erreur récupérable |

Le jitter de retry est calculé une fois puis persisté pour rendre les tests et
les réveils déterministes. Les messages UI restent stables et n’exposent ni
stack, ni titre privé, ni URL privée.

## Scénarios opérationnels

### Première installation

Le background ouvre Dexie, crée une session d’inventaire, traite les tranches,
importe chaque source et laisse la file reprendre la résolution. L’UI peut
afficher séparément import en cours, bibliothèque vide réelle et Review en
attente. Elle ne prétend pas que l’analyse est terminée avant le dernier
checkpoint.

### Modification ou déplacement

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

La première étape de stockage ajoute une version Dexie additive au-dessus de
v5 avec les stores d’artefacts, tâches et checkpoints ainsi que leurs index de
lecture. Elle ne supprime et ne renomme aucun store existant.

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
| arbre complet aplati en mémoire | itérateur, tranches et checkpoint | grand inventaire repris après suspension |
| import seulement à l’installation | quatre événements + réconciliation | tests création/changement/déplacement/suppression |
| favori traité comme autorité | commande d’import vers IndexedDB | suppression sans cascade |
| type manga par défaut | `UNKNOWN` jusqu’à une preuve | U-02 et routage séparé |
| protocole ou origine réécrits | URL brute préservée | U-10 |
| premier résultat ou popularité | unicité par niveau | permutations sans changement de décision |
| attentes longues en mémoire | `nextAttemptAt` et alarme | suspension à chaque checkpoint |
| effets potentiellement dupliqués | claim, empreinte et clé idempotente | course entre deux réveils |
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
   synthétiques et oracle profond; aucun runtime activé.
2. **Parser pur** — qualification, preuves génériques, normalisation, identité,
   saison, progression et artefact; matrice P/U/T/I/S/R verte.
3. **Adaptateurs de source** — règles URL isolées et tests de provenance;
   aucune permission ou requête réseau.
4. **Stockage durable** — migration additive, tâches, claims, checkpoints et
   backfill borné; tests Chromium de v1 à la nouvelle version.
5. **Resolver désactivé** — routeur, transports injectés et matcher derrière un
   port non composé; tests 429/403/timeout/taille/permutation.
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
  inversé, doublon et rediffusion donnent le même état final.
- **Parsing** : les 82 cas de la spécification et l’artefact complet restent
  déterministes.
- **Résolution** : ID explicite, URL officielle, titre exact, saison, mots
  réordonnés, distance bornée, égalité et no-match.
- **Fournisseurs** : timeout, offline, 403, 429, 5xx, mauvaise origine,
  redirection, mauvais type, JSON invalide, plus de 64 Kio ou trop de candidats.
- **Durabilité** : suspension avant/après claim, réponse, décision, hydratation
  et commit; claim expiré et deux runners concurrents.
- **Migration** : v1, v2, v3, v4 et v5 conservent œuvres, sources, Reviews,
  progression, Agenda et organisateur; backfill interrompu puis repris.
- **UI** : import en cours, vide réel, Review, partiel, hors ligne, retry et
  erreur récupérable sans contenu fictif.
- **Sécurité** : aucune donnée privée dans URL publique, log, fixture ou
  télémétrie; aucun réseau depuis les surfaces.
- **Performance** : aucun scan illimité, transaction au plus 100, huit tâches
  par réveil, réponse à temps borné et taille de bundle surveillée.

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
npm run sensor -- --format json
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
- l’inventaire, les fournisseurs et les projections respectent leurs bornes;
- une suspension à n’importe quel checkpoint converge sans doublon métier;
- les migrations préservent toutes les données v1 à v5 sans remise à zéro;
- Review expose toutes les ambiguïtés et aucune sélection implicite;
- les surfaces ne lisent que les projections locales validées;
- les tests navigateurs prouvent installation, reprise, événements et hors
  ligne;
- `npm run verify` et Archify showcase passent sans erreur ni avertissement.

Ne sont pas inclus : copie de code ou de données FavLib, scraping HTML,
activation silencieuse d’un fournisseur, synchronisation privée cloud,
suppression automatique d’œuvres, publication ou déploiement.
