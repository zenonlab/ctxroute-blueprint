# Pipeline de reconstruction des favoris

- Version de pipeline : 4
- Contrat comportemental : `favorite-parsing-resolution-spec` v3 et [plan correctif v3](favorite-resolution-correction-plan.md)

## Statut et portée

Ce document décrit la pipeline cible qui met en œuvre le contrat canonique
[`favorite-parsing-resolution-spec.md`](favorite-parsing-resolution-spec.md) et
l’ADR-0037. Il explique comment passer du runtime actuel à une résolution
complète sans porter les monolithes FavLib.

Il ne remplace pas la spécification des règles. La spécification décide ce
qu’un indice signifie; ce document décide où il est produit, persisté, repris,
testé et projeté.

Le navigateur possède présence et progression observée; IndexedDB possède
les transactions privées. Sync restaure les IDs et leurs associations à une
empreinte normalisée, jamais les titres ni la navigation. Le Worker seul
possède D1. Le cache public n’a ni owner ni appairage : le client réserve une
clé `PENDING`; le consumer Queue natif publie seul `VERIFIED` après hydratation
et contrôle des titres
officiels. La pipeline et ses budgets suivent le plan v3; la section suivante
décrit l'ancien runtime, qui ne constitue pas le résultat cible.

Les permissions du paquet MV3 sont limitées à l’origine publique TobiRink.
AniList, MangaUpdates, MangaDex et Kitsu ne sont jamais contactés par
l’extension.

## État implémenté vérifié

### Correctif de livraison 1.0.9

Le contrôle dans Chrome a montré que MangaDex renvoie une image promotionnelle
avec HTTP 200 lorsque le référent est le site. Les cartes demandent les images
avec `referrerPolicy="no-referrer"` pour ne pas transmettre la navigation privée.
Un échec de chargement affiche le placeholder accessible. Une URL présente ou
un HTTP 200 ne suffisent pas à certifier visuellement une couverture.

La préférence MangaUpdates réutilise le matcher : enveloppe complète,
identité unique compatible et aucun choix par ordre API ou disponibilité d’image.
Une réparation ne remplace pas une jaquette existante par un candidat sans image.
Les anciens blocages sont repris une fois avec un reçu conservant les données
précédentes; les décisions humaines restent protégées. Une tâche atteint
`BLOCKED/AUTOMATIC_ATTEMPT_LIMIT` après huit échecs et attend alors une reprise
explicite au lieu de programmer indéfiniment de nouvelles alarmes.
Une restauration sync indisponible ne bloque plus les favoris locaux déjà importés.
Le repli HTTP 405 MangaUpdates conserve l’ID exact aussi après une recherche par
titre ou un alias local; une page incomplète ne peut pas prouver un introuvable.
Le test navigateur multi-fournisseurs lit la version courante du paquet et
vérifie les images décodées ainsi que l’absence de référent.

### Diagnostic du fallback MangaDex systématique

Le 11 septembre 2026, une recherche publique MangaUpdates répond 403 avec
un Origin d'extension et 200 sans Origin. Le manifeste FavLib embarquait une
règle déclarative supprimant cet en-tête pour l'API MangaUpdates; TobiRink
l'avait omise. Le résolveur aggravait ce défaut en passant au fournisseur
suivant sur tout HTTP 403. La règle locale est restaurée, sans relais Worker,
et les refus restent RETRYABLE. Le test installé active et désactive la règle
dans un profil Chromium isolé et reproduit 403 puis 200 avec 25 résultats.

Le décodage réel a aussi révélé des URL de couverture `null` dans une page
de résultats. Ces absences sont acceptées sans perdre les identités de la page;
le contrat de candidat continue à omettre la couverture indisponible.
Les œuvres MangaDex déjà stockées ne sont pas supprimées par ce correctif.
Le rapprochement existant reste conservateur, et ne remplace pas une migration
complète des choix automatiques antérieurs. La vérification de la bibliothèque
privée installée reste distincte de ces tests de transport et de résolution.

### Variantes parenthésées et projection automatique

L'audit FavLib du commit `3267de2` a révélé quatre comportements manquants
dans la réécriture : regroupement d'un exact avec ses éditions parenthésées,
aliases sûrs d'un titre parenthésé complet, variantes de découverte distinctes
des preuves, et alimentation effective des filtres OVA/pré-sérialisation.
`favorite-parser-v5`, `favorite-matcher-v4` et la fenêtre de recherche v3
ferment ces écarts sans réintroduire l'inclusion partielle, le sous-titre seul,
la popularité ou la couverture de tokens de FavLib.

`Existence` comparé à deux fiches `Existence` et `Existence (Wangho)`
produit donc Review avec les deux identités. `Existence (Wangho)` conserve
son exact complet. Les années, parenthèses imbriquées, formats, langues et
marqueurs Novel restent des qualificatifs. Le rescan change le fingerprint,
protège les décisions humaines et réenfile les décisions automatiques. Si
l'ancien Work automatique n'est plus référencé par une autre source observée
résolue, seule son appartenance à la bibliothèque dérivée est retirée; Work,
progression et reçus restent stockés.

### Routes Comix et panne de la lane anime

La forme Comix `/title/identifiant-titre/identifiant-chapter-numéro` était
rejetée par l'analyse générique; la fiche sans chapitre gardait UNKNOWN et
son préfixe opaque dans le titre. Les règles embarquées v2 déclarent ces deux
routes comme MANGA, retirent seulement le préfixe opaque de cinq caractères
du slug recherché et conservent l'URL canonique exacte. Les chapitres zéro
et décimaux restent des progressions, les nombres du titre restent intacts.
Les pages de collection ne deviennent pas des œuvres.

Un rescan des anciennes sources UNSUPPORTED change leur fingerprint et les
réenfile sans suppression ni Review artificielle. Un cache propriétaire de
règles plus ancien ne peut pas remplacer la version embarquée. Le parcours
installé utilise une URL Comix synthétique et refuse une recherche anime de
ce titre afin de détecter une régression de classification.


Le runtime actuel possède déjà des fondations réutilisables :

- `WebExtensionBookmarkImportAdapter` parcourt l’arbre avec
  `bookmarks.getChildren`, par tranches de 100 feuilles et curseur DFS;
- `normalizeBookmarks` qualifie uniquement les URL HTTP(S);
- `importFavoriteSources` écrit `FavoriteSource`, artefact et tâche par
  transactions de 100 entrées et conserve `importedAt` lors d’un nouvel import;
- Dexie v8 stocke les données privées dans `tobirink-private`;
- les lectures `FavoriteSource` et `Review` sont paginées et limitées à 100;
- Review limite une réponse à six candidats et son client HTTP refuse les
  réponses supérieures à 64 Kio;
- le WebBridge v4 parcourt toute la Bibliothèque par lectures locales de 100,
  limite les pages à 24, Agenda à 100 entrées et ses enveloppes à 64 Kio;
- les modules purs `title-segmentation`, `season-extraction`,
  `progression-extraction` et `favorite-parser` produisent désormais l’artefact
  local T/I/S/R, son empreinte et toutes les preuves/rejets sans I/O;
- le background compose les ports locaux, les adaptateurs AniList et
  MangaUpdates, puis lance la convergence à l’installation, au démarrage, sur
  alarme et sur les quatre mutations de favoris; le démarrage reprend le
  checkpoint existant sans forcer un nouvel inventaire complet;
- l’import persiste atomiquement `FavoriteSource`, artefact et tâche, sans
  créer de Review;
- l’outbox IndexedDB v8 réclame les tâches dues par index composé sans
  `toArray()` global, huit au plus par tranche;
- le runner recherche, décide, hydrate par ID exact, puis écrit `Work`,
  Bibliothèque, Review et reçu de tâche dans une transaction;
- les cadences fournisseur sont sérialisées et leur `nextAllowedAt` est écrit
  dans IndexedDB avant chaque effet HTTP;
- les checkpoints d’inventaire, la dernière mutation de chaque favori, les
  marques de présence, les reçus de résolution et les candidats ambigus sont
  persistés dans des stores additifs;
- l’oracle canonique exécute réellement qualification, parser, matcher et
  projection sur les 82 identifiants synthétiques et compare leur snapshot
  profond versionné;
- la langue locale facultative arbitre déclarations fortes, statistique fiable
  et `hreflang` faible sans introduire de réseau ni de décision implicite;
- une source absente est marquée `detached`; elle reste sauvegardable mais ne
  fournit plus de lien à Review, Agenda, Organisateur ou popup.
- une route HTTP ordinaire sans preuve média reste
  `UNSUPPORTED/IDENTITY_MISSING`; une route générique qui prouve un chapitre,
  un épisode ou un volume peut employer son titre de favori nettoyé et entrer
  dans les lanes `UNKNOWN`;
- une route imbriquée de type `anime/{identité}/{sortie}-02-vostfr` conserve le
  segment d'identité précédent et sépare la progression de la clé recherchée.

L’inventaire ne matérialise jamais l’arbre complet : le runtime reprend le
curseur durable, traite au plus huit tranches de 100 par réveil puis programme
la convergence suivante. La dernière mutation de chaque favori est journalisée
avant le réveil; aucune suppression de favori ne cascade vers une œuvre ou sa
progression.

## Résultat attendu

RESOLVED, REVIEW_REQUIRED (AMBIGUOUS ou NOT_FOUND), UNSUPPORTED ou RETRYABLE.
Aucune Review à l'import; la cloche contient uniquement les décisions humaines
actionnables après résolution terminale. no-match est une confirmation humaine.
Chaque résultat porte versions, source, révision, provenance et reçu.

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

Le popup ne fabrique jamais une œuvre depuis le seul titre de l'onglet actif.
Il affiche et mémorise une reprise uniquement lorsque la page correspond à une
unique `FavoriteSource` observée déjà liée à un `Work` local. Les anciennes
reprises génériques sans identifiant `Work` sont ignorées lors de la lecture du
cache; aucune ligne IndexedDB n'est supprimée.

Le WebBridge renouvelle sa session courte après chaque expiration tant que le
handshake et les projections initiales sont valides. Chaque renouvellement
réussi réarme le suivant; un renouvellement défaillant s'arrête après cet essai
et expose l'état récupérable sans boucle de requêtes.

Le message interne `library.page.read` est conservé pour compatibilité avec les
anciens écrans extension. Il n'est plus consommé par les surfaces actuelles :
la bibliothèque extension utilise `library.catalogue.read` et le site utilise
`library.read` via WebBridge. Sa suppression éventuelle fera l'objet d'une
étape destructive séparée.

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
automatique et conserve un diagnostic hors cloche; il ne tronque jamais silencieusement le brut.

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
ne crée aucune `Review` et enregistre l’artefact. Avec une identité média, une
sortie média corroborée par un titre exploitable, ou un ID fournisseur
explicite, elle ajoute une entrée `READY` dans l’outbox `ResolutionTask`. Sans
aucune de ces preuves, elle écrit le résultat
`UNSUPPORTED/IDENTITY_MISSING`, la tâche `COMMITTED` et son reçu dans la même
transaction. Aucun appel réseau n’a lieu avant le commit.
L’identité locale reste dérivée de l’identifiant du favori selon le contrat
actuel; `importedAt` et une décision Review existante sont préservés.

La file séparée `tobirink-durable-tasks` reste réservée aux notifications
Agenda. La résolution réutilise les fonctions pures de transition de tâche,
mais pas l’adaptateur qui empêcherait la transaction atomique avec les sources.

Une suppression navigateur marque seulement la source comme non observée ou
détachée. Elle ne supprime ni `Work`, ni progression, ni Agenda, ni décision
Review. Une purge future demanderait une action produit séparée et explicite.

### 6. Réserver et router la résolution

Le runner réclame au plus 100 tâches dues et s’arrête après 20 secondes par
réveil. Le claim de 60 secondes, son expiration et l’`idempotencyKey` sont
persistés avant l’effet. Le routeur applique l'ordre du plan v3 : ID URL, règle exacte origine/route,
artefact/aliases, fiche hydratée, cache D1 public vérifié, recherche locale,
puis Review terminale seulement. AniList anime et MangaUpdates manga sont
prioritaires; Kitsu suit seulement NO_MATCH complet. MangaDex reste exact/sorties.
Type inconnu : deux lanes indépendantes, ambiguïté inter-types explicite.
Panne, 429, timeout ou ensemble incomplet ne déclenche aucun arbitre suivant.

La surface Options lit les compteurs terminaux et le checkpoint d’inventaire,
puis distingue `inventory`, `presence`, `resolving`, `waiting-provider`,
`blocked`, `paused` et `complete`. Elle actualise l’affichage pendant les états
actifs et au retour de visibilité; cette lecture ne réclame aucune tâche et ne
contacte aucun fournisseur. Elle réarme seulement une alarme absente ou échue.
Les commandes de reprise, pause et remise en file des tâches bloquées sont
acceptées uniquement depuis la page Options de l’extension.

Les ports candidats/hydratation restent séparés et DTO Zod stricts. La décision
pure applique ID, URL, exact, saison, tokens, distance sans score de popularité.


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

La page fournisseur est ramenée à vingt candidats au plus, avec validité,
curseur, hasMore et exhaustivité pertinente distincts. L'agrégation est bornée
et checkpointée par page/alias. Unicité et absence exigent un ensemble pertinent
complet. Budget atteint ou page manquante : RETRYABLE avec curseur, sans fallback.
Deux identités déjà prouvées au même niveau suffisent à établir l'ambiguïté.
Review expose six candidats comparables au plus et signale les candidats non
exposés. Images, dates, popularités et positions de réponse ne prouvent rien.

Avant chaque niveau, `CandidateCompatibility` applique symétriquement le type,
OVA et pré-sérialisation. Le filtre éditorial de taxonomie n’intervient jamais
ici et ne peut donc pas fabriquer une identité.

Le runner dérive ces deux compatibilités du titre brut et des aliases locaux :
présence explicite de `OVA`/`OAV` contre absence, et présence explicite de
`Novel` ou pré-sérialisation contre absence. Une option du matcher qui n'est
pas alimentée par le runner ne constitue pas une validation de ce contrat.

### 8. Persister la décision

`CERTAIN` conserve la référence exacte dans la tâche de résolution déjà
réclamée et passe directement à son étape d’hydratation.
`AMBIGUOUS` met la Review en attente avec sa révision et les motifs.
`NO_MATCH` complet conserve la source/artefact et crée une Review pending
NOT_FOUND actionnable, sans Work. Seul le choix humain écrit no-match.
Une décision humaine exige la révision courante et un candidat appartenant à
l’ensemble autorisé. Une décision obsolète échoue en conflit.

### 9. Hydrater par identifiant exact

L’hydratation demande la fiche par couple `(provider, externalId)`, valide une
projection bornée, puis écrit Work, lien direct FavoriteSource→Work et reçu dans une transaction;
une Review éventuelle est mise à jour, jamais créée pour un succès.
Elle ne relance pas une recherche de titre. Les enrichissements Agenda ou
média deviennent des tâches distinctes afin qu’un échec secondaire ne remette
pas en cause l’identité acquise.

Le mapper d’hydratation versionné normalise séparément le statut public. Le
`ContentTaxonomyPolicy` s’exécute ensuite sur les genres et catégories hydratés,
par égalité normalisée exacte; il conserve les valeurs brute et normalisée et
ne modifie jamais la décision d’identité. Les caches locaux expirent après au
plus 24 heures pour un résultat positif et 15 minutes pour une absence.

Une taxonomie bloquée ne rejoint pas la bibliothèque et n’est jamais proposée
comme candidat manuel. La résolution devient `UNSUPPORTED`, hors cloche, avec le diagnostic
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

- Bibliothèque à partir des `FavoriteSource` observées et artefacts titrés dès
  l’import, puis des `Work`, métadonnées d'affichage et progressions locales;
- Review à partir des seules pending AMBIGUOUS/NOT_FOUND et de leurs preuves;
- Agenda à partir des entrées locales dans la semaine demandée;
- WebBridge v4 à partir de ces projections sérialisées et validées. Sa page
  Bibliothèque transporte les facettes, tris, statistiques, jaquettes
  attribuées, progression structurée et source nécessaires à l'affichage.
  Elle ne transporte ni dossier de favoris, ni décision, ni secret.

Une `Work` absente ne masque plus une identité locale parsée. Le catalogue
projette une entrée déterministe `preparation`, `retryable` ou `review`, sans
la persister comme œuvre ni lui inventer un fournisseur. Le type inconnu reste
`unknown`. Une source détachée, `UNSUPPORTED` ou sans identité exploitable reste
hors bibliothèque. Quand le `Work` résolu existe, la même lecture retire
l’entrée provisoire et conserve une seule œuvre. Une lecture UI ne déclenche
aucun réseau et ne remplace aucune donnée manquante par une fixture.

Le commit `RESOLVED` écrit atomiquement la `Work`, son association à la
`FavoriteSource` et la progression chapitre, épisode ou volume extraite du
favori. Une observation plus basse ne remplace jamais une progression locale
plus avancée. WebBridge retrouve la source directement par `matchedWorkId`;
une Review résolue n'est pas requise pour ouvrir le favori d'origine.

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
| `ProviderCandidateEnvelope` | identité, titres localisés, jaquette attribuée, faits normalisés, curseur, `complete`, `truncated`, digest | adaptateur fournisseur | matcher pur et projection locale |
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
| `X-01…X-02` | adaptateur MangaDex exact et garde de progression commune | `X-01` et `X-02` requis |
| `U-01…U-10` | éligibilité et preuves URL | oracle d’artefact |
| `T-01…T-10` | segmentation et nettoyage du titre | oracle d’artefact |
| `I-01…I-07` | construction d’identité | oracle d’artefact |
| `S-01…S-07` | saison | oracle d’artefact |
| `R-01…R-14` | progression | oracle d’artefact |
| `Q-01…Q-08` | outbox, scheduler et claims | tests de suspension/concurrence |
| `B-01…B-05` | événements et inventaire | tests WebExtension |
| `O-01…O-02` | corpus synthétique | gate d’équivalence |

## Fiche d’exécution par composant

| Composant | Entrée → sortie | Limite | Échec et reprise | Idempotence | Preuve minimale |
| --- | --- | --- | --- | --- | --- |
| Capture d’événement | événement API → commande | 1 événement, 64 Kio | valeur invalide en diagnostic hors cloche | bookmark ID + révision d’observation | tests des 4 événements et installation |
| Inventaire | enfants de dossier → tranches d’observations | 100 feuilles/tranche | checkpoint puis reprise | session + pile + curseur | grand arbre, dossier unique large, suspension |
| Qualification | observation → admissible/rejet | 1 | fail-closed | fonction pure | cas U-08/U-09/U-10 |
| Preuve URL | admissible → `SourceEvidence` | 32 preuves, 16 aliases | preuve générique ou rejet | fonction pure | U-01 à U-07 |
| Parser | brut + preuves → artefact | 64 Kio, 64 transformations, 32 diagnostics | motif stable, aucune exception opaque | empreinte sémantique | matrice P à R + oracle profond |
| Import | artefact → source et tâche sans Review | 100/transaction | rollback transactionnel | ID source + empreinte | relecture et décision existante |
| Claim | tâches dues → tâches réservées | 8/20 s, claim 60 s | expiration durable | clé unique d’effet | deux workers, lanes isolées, claim expiré |
| Transport | requête publique → enveloppe complète | 20 candidats, 512 Kio, 8 s | tronqué fail-closed, erreur typée | clé tâche + requête | timeout, 403, 429, JSON invalide, page manquante |
| Matcher | artefact + candidats → décision | 20 | ambiguïté explicite | fonction pure | permutations et égalités |
| Review | décision → choix confirmé | 6 candidats, 100 pending | conflit de révision | review + révision + choix | stale, skip, no-match, resolve |
| Hydratation | ID exact → `Work` | 1 fiche, 512 Kio, 8 s | retry sans rematch | fournisseur + ID + version | replay après commit réseau |
| Langue locale | document déjà observé → preuve | 24 déclarations, 160 caractères, texte ≥ 80 | `undetected` ou `ambiguous` | entrée + version analyseur | L-01 à L-05 |
| Taxonomie | fiche hydratée → admissible/bloquée | listes fermées versionnées | blocage éditorial explicite | fiche + version politique | C-01/C-02 |
| Projection | stores → snapshot UI | 100/transaction, 24/page, 64 Kio | reprise au prochain rafraîchissement | lecture pure | 1 400 œuvres, données manquantes, vide |
| Réconciliation | pages locales → tâches manquantes | 100/page, 8 créées/réveil | curseur durable | index uniques | interruption à chaque checkpoint |

Les limites nouvelles sont normatives : 8 secondes par requête, 20 candidats,
8 tâches et 20 secondes par réveil, claim de 60 secondes, huit tentatives,
backoff de 30 secondes à 6 heures, AniList 2 200 ms, MangaUpdates 3 000 ms et
batch AniList de 50. Les limites déjà actives de 100, 6, 24 et 64 Kio ne
doivent pas être dupliquées sous forme de constantes concurrentes.

L’outbox conserve l’artefact courant et au plus son prédécesseur par source;
un artefact référencé par une Review ouverte ou une tâche non terminale est
épinglé. Chaque commit écrit atomiquement l’unique `ResolutionReceipt` courant
de son couple `(sourceId, operation)` puis, après 30 jours, compacte la tâche
`COMMITTED` correspondante :
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
contrat ou huit tentatives automatiques mène à
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
| identité média non prouvée | UNSUPPORTED avec motif | nouvelle preuve locale |
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

Le background ouvre Dexie, crée une session d’inventaire par dossiers et traite
huit unités de travail au maximum. Les lots `inventory` importent 100 favoris;
les pages `presence` vérifient 100 sources. Le dernier lot navigateur ouvre la
phase de présence et seule la transaction de la dernière page écrit `complete`.
Options explique lecture, vérification de présence, identification et demandes
humaines, affiche la prochaine reprise et permet de reprendre sans recommencer
une phase active.

### Modification ou déplacement — cible après durcissement d’inventaire

L’événement est d’abord journalisé dans IndexedDB, puis force un nouvel
inventaire borné et reprenable de l’autorité navigateur. Un titre, une URL, un
chemin ou un ordre modifié met à jour la source. Seule une modification qui
change l’empreinte de parsing invalide la résolution automatique; un déplacement
de dossier ne relance pas un fournisseur.

### Suppression navigateur

La source est marquée détachée après vérification de l’événement. La présence active est recalculée; les œuvres et la progression historique
restent conservées. Une réapparition avec le même identifiant
réactive la source sans perdre l’historique.

### Suspension et mode hors ligne

Chaque étape reprend depuis IndexedDB. Hors ligne, aucune donnée autoritaire
n’est effacée et les tâches réseau reçoivent une échéance. Le runner s’arrête
après son lot puis lit, par index composé et sans scan, la première échéance
READY, RETRY_AT ou CLAIMED expirée. Il programme une alarme ponctuelle nommée à
cette date avec un plancher de 30 secondes et libère le service worker. Le même
nom remplace toute reprise déjà programmée; l’absence de tâche efface l’alarme.
Chaque nouvelle évaluation du service worker répare cette alarme depuis le
checkpoint et les index de l’outbox. Le réveil périodique des notifications ne
résout rien : il vérifie seulement cette programmation et la recrée si besoin.
Le contrôleur expose la phase d’inventaire tant que son checkpoint est actif,
puis la résolution, l’attente fournisseur, le blocage ou la convergence selon
l’état durable de la file. Une pause locale efface l’alarme et interdit un
nouveau claim après la tâche déjà en cours.

### Retry manuel

L’action bornée remet au plus 100 tâches `BLOCKED/AUTOMATIC_ATTEMPT_LIMIT` à
la tentative zéro, efface uniquement ce résultat automatique et conserve la
source, l’artefact, l’œuvre et les décisions humaines. Elle ne déclenche pas un
scan global et ne contourne pas les bornes de claim.

## Migration depuis Dexie v5

Les versions Dexie v6 à v8 sont additives au-dessus de v5 dans
`tobirink-private`. V6 ajoute `favoriteArtifacts` et
`favoriteResolutionTasks`; v7 ajoute le journal, les checkpoints et les marques
d’inventaire; v8 ajoute cadence fournisseur, reçus et candidats Review. La tâche porte la lane
`routing`, une clé d’idempotence unique et l’index composé défini plus haut.
L'ancien import v6–v8 écrivait source, Review, artefact et tâche ensemble.
La correction v3 conserve source/artefact/tâche atomiques sans créer de Review. Aucun store existant n’est supprimé ou renommé. Le checkpoint
d’inventaire reste une étape ultérieure; la base séparée des notifications
n’est ni migrée ni utilisée par le resolver.

| Store | Index nécessaires |
| --- | --- |
| `favoriteSources` | index existants, puis `observationSequence`, `semanticFingerprint`, `[presence+id]` |
| `favoriteArtifacts` | `&sourceId`, `reviewId`, `recordedAt`, `artifact.semanticFingerprint` |
| `favoriteResolutionTasks` | `&id`, `&idempotencyKey`, `kind`, `lane`, `state`, `availableAt`, `[kind+lane+state+availableAt]` |
| `favoriteResolutionReceipts` | `&id`, `&idempotencyKey`, `sourceId`, `completedAt` |
| `favoriteInventoryCheckpoints` | `&id`, `status`, `sessionId` |
| `favoriteInventoryMarks` | `&bookmarkId`, `sessionId` |
| `favoriteBookmarkMutations` | `&bookmarkId`, `sequence`, `kind` |
| `favoriteProviderRateCheckpoints` | `&provider` |
| `favoriteReviewCandidateSets` | `&reviewId`, `recordedAt` |

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
| arbre complet aplati en mémoire | parcours `getChildren`, tranches et checkpoint | reprise testée sans rematérialiser l’arbre |
| import seulement à l’installation | quatre événements + réconciliation | tests création/changement/déplacement/suppression |
| autorité navigateur perdue | présence/progression navigateur restaurées | détachement sans cascade |
| type manga par défaut | `UNKNOWN` jusqu’à une preuve | U-02 et routage séparé |
| protocole ou origine réécrits | URL brute préservée | U-10 |
| premier résultat ou popularité | unicité par niveau | permutations sans changement de décision |
| attentes longues en mémoire | `nextAttemptAt` et alarme | suspension à chaque checkpoint |
| effets potentiellement dupliqués | claim, empreinte et clé idempotente | course entre deux réveils |
| file générique scannée avec `toArray()` | outbox atomique et claims par index/lanes | coût du claim indépendant de la taille totale |
| ensemble fournisseur tronqué | `complete`/`truncated` interdit un faux `CERTAIN` | candidat compatible caché après la limite |
| données brutes perdues | artefact immuable avec provenance | audit de chaque transformation |
| no-match masqué | NOT_FOUND pending puis no-match humain | états UI et motifs stables |
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
- une demande publique ne contient qu’une empreinte versionnée et des titres
  bornés; seul le consumer Queue natif peut publier `VERIFIED`.

## Ordre de livraison historique remplacé

Les huit étapes du [plan v3](favorite-resolution-correction-plan.md) sont
l'ordre d'exécution approuvé. Les vagues ci-dessous décrivent l'ancien chantier,
pas une autorisation concurrente.

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
  doit désormais être couvert par l'adaptateur MangaDex exact.
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
  candidat compatible masqué après la limite, rollback des trois écritures de
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

## Audit historique du 2026-09-07 — source de cas clean-room

L'audit de correction du 2026-09-08 remplace la recherche de parité avec FavLib
par un contrat TobiRink indépendant. Les observations historiques servent à
concevoir des cas synthétiques; aucune base, donnée ou exécution FavLib n'entre
dans la validation.

L’audit du code, des tests et des migrations confirme les frontières
domaine/application/adaptateurs, le parser et le matcher sans I/O, l’outbox v8
atomique et indexée, les limites réseau et locales, et l’absence de cascade à la
suppression d’un favori. Chromium valide les migrations et le contrat réel
IndexedDB.

La certification finale couvre aussi le paquet Chrome réellement chargé avec
cinq résolutions synthétiques : AniList et MangaDex par référence exacte,
MangaUpdates comme source manga principale, puis Kitsu Anime et Kitsu Manga
après `NO_MATCH` complet de la source principale. Les cinq fiches atteignent la
bibliothèque locale avec leur progression et leur jaquette attribuée; le
rechargement hors ligne conserve le résultat et la table Review reste vide.

MangaUpdates impose une page minimale de 25 éléments. Cette page est inspectée
entièrement avant réduction au contrat de 20 candidats comparables. Une page
sans candidat comparable peut avancer vers son curseur suivant; une réponse
incomplète ne devient jamais `NO_MATCH`. Le checkpoint sérialise les
métadonnées v1 et v2 afin qu'une suspension MV3 ne perde ni la couverture, ni
les variantes de titre, ni les facettes déjà hydratées.

Les trois écarts précédemment critiques sont fermés : inventaire
`getChildren()` reprenable et journalisé; assertions sémantiques exécutées pour
les familles `L/Q/B/X` en plus de l’oracle profond 82 / 77 / 4 / 1; reçus,
compaction bornée, cadence fournisseur, preuve de langue locale et candidats
ambigus persistés. La validité reste conditionnée au passage du gate racine
`npm run verify`; elle n’autorise ni publication ni déploiement.

## Audit de l'installation vivante — 2026-09-11

L'outbox de résolution est locale à IndexedDB. Le Worker ne possède pas de
consumer ni de Cron pour les tâches privées; les anciennes routes
`/v2/favorites/*` concernent le protocole owner-scoped remplacé par l’ADR-0046
et ne font pas partie de l’architecture cible. Un réveil
du background effectue l'inventaire puis une seule tranche de huit tâches, ce
qui explique un compteur élevé de sources « en cours » après un import massif.
Les curseurs d’inventaire et de présence, la tranche de résolution et l’alarme
ponctuelle sont désormais séparés et persistés. Depuis la 1.0.16, ces tâches
restantes n’empêchent plus les titres parsés d’apparaître dans la bibliothèque.

L'inspection D1 en lecture seule du 2026-09-11 indique zéro règle publiée,
zéro propriétaire et zéro installation. Tant qu'un document de règles validé
n'est pas publié par la gate, seule la règle intégrée Anime-Sama est active.

Le parseur générique exige toujours une preuve de route média. Quand une route
prouve une sortie mais que son segment d'identité est opaque ou structurel, il
emploie désormais le titre du favori après retrait de la progression et du nom
de domaine. L'artefact reste `UNKNOWN` et lance les lanes anime et manga. Les
routes utilitaires, ressources ordinaires, adaptateurs exacts ayant rejeté leur
route et identités réellement inexploitables restent `UNSUPPORTED`.

## Définition de terminé

### Diagnostic verrouillé de la file

La version 1.0.15 relie les phases `inventory` et `presence` à une continuation
MV3 durable. Chaque réveil consomme au plus huit pages locales de 100 éléments;
la résolution traite ensuite au plus 100 tâches ou 20 secondes. La page de
présence et son checkpoint sont atomiques. Une fois `complete`, les réveils
fournisseurs et le démarrage réutilisent l’inventaire sans rescanner les favoris.
Installation, mise à jour, restauration et audit périodique forcent un nouvel
inventaire et peuvent réparer la projection complète; une mutation traite
directement son favori. Une action
manuelle reprend le checkpoint actif ou vérifie à nouveau un état complet.
L’outbox choisit sa première échéance par trois lectures indexées bornées;
`tobirink-favorite-resolution-continuation-v1` est restaurée à chaque démarrage
du service worker et contrôlée par le réveil périodique sans appel fournisseur.
Une alarme future déjà présente n’est pas repoussée par les lectures d’état.
Options relit automatiquement les phases actives, permet la pause persistante
et rend actionnable la limite de huit tentatives.

Le bootstrap WebBridge calcule le nombre visible depuis la longueur de la
bibliothèque et trois comptes indexés : sources observées, résolues et non
prises en charge. Il ne scanne pas les motifs `RETRYABLE` et ne construit plus
les facettes ni le tri du corpus complet. La lecture du catalogue conserve ces
résultats exacts mais charge les `Work` et artefacts avec `bulkGet`, puis les
progressions avec `anyOf(workIds)`, en lots de cent identifiants au maximum.
Le contrat Chromium couvre un corpus mixte de 1 400 entrées résolues et
provisoires; aucune lecture unitaire par œuvre ou artefact n'est nécessaire.

La version 1.0.14 ajoute deux diagnostics indépendants. Le Worker produit des
événements structurés uniquement avec la valeur exacte `worker-v1`; ils
contiennent famille de route, méthode réduite, statut, durée bornée et ID de
corrélation. L'extension conserve localement au plus 100 phases de traitement
uniquement avec la valeur exacte `extension-v1`. Options affiche son état, son
dernier événement et permet de l'activer ou de le désactiver. Le buffer local
n'est jamais envoyé au Worker, à D1, à `storage.sync` ou à WebBridge.

Les titres, URL, dossiers, progressions, identifiants fournisseurs, corps de
requête, erreurs brutes et secrets sont absents des deux contrats. Une panne du
diagnostic est absorbée et ne modifie jamais le résultat de résolution.

### Corrections de robustesse du 12 septembre 2026

La candidate locale 1.0.21 valide ce flux sur 1 406 favoris installés dans
Chromium : l'inventaire et la présence convergent par alarmes MV3 sans commande
manuelle, le cache public est consulté avant les deux aliases de recherche du
cas `UNKNOWN`, et l'arrêt du service worker conserve cinq projections et son
alarme. Le résultat compte 1 401 liens ordinaires exclus, une résolution D1,
quatre reprises fournisseur, zéro traitement résiduel et zéro Review. Firefox
151 installe l'archive distincte et confirme le health check, l'exclusion d'un
lien ordinaire et l'absence de Review à l'import.

La version 4 rend la réinstallation cache-first. Chaque favori média parsé est
projeté dès son lot d’inventaire. Le snapshot sync v2 relie son empreinte
normalisée aux références fournisseur publiques et reste compatible avec les
listes v1. Sa restauration, son scan de publication et l’inventaire possèdent
chacun une continuation durable jusqu’à `COMPLETE`; leurs résultats incomplets
ne sont plus ignorés. Le resolver prépare ensuite, par lots dédupliqués de 50
clés, l’association sync et le cache public D1, puis seulement les fournisseurs.
Le Worker reçoit uniquement empreinte, type et versions pour le claim. Un seul
client obtient un bail de recherche; les autres reçoivent `PENDING`. Après
résolution locale, le client propose uniquement des identifiants publics. Le
collecteur OIDC vérifie les profils et publie `VERIFIED`; un échec reste
reprenable sans N+1 ni requête cache par œuvre.

Le producteur de snapshot lit cent œuvres ou sources par page, persiste chaque
curseur et consomme au plus seize pages dans un réveil. Il publie ainsi les
identités d’un inventaire de 1 406 favoris sans attendre quinze alarmes de
trente secondes. Une bibliothèque plus grande garde le même checkpoint et
continue au réveil suivant. Sous Chromium, les zones sensibles utilisent
directement `chrome.storage.local` et `chrome.storage.sync` afin que la
restriction `setAccessLevel` soit réellement appliquée; Firefox utilise les
zones WebExtension natives avec le même contrat.

Le scénario installé prouve la frontière de reconstruction : il attend un
manifeste v2 validé, arrête le service worker, supprime `tobirink-private`, coupe
le cache HTTP public et relance le runtime. Les 1 406 sources réapparaissent,
l’identité AniList synchronisée est hydratée par ID exact et aucune recherche
par titre de cette œuvre n’est émise. Le blob synchronisé ne contient que les
références publiques, empreintes et versions autorisées.

### Sauvegarde privée locale

`storage.sync` ne remplace pas une sauvegarde de l’historique. La page Options
peut télécharger un fichier chiffré qui contient les huit agrégats privés.
L’export v5 reste compatible en lecture avec les
versions 1 à 4. AES-GCM protège tout le contenu et PBKDF2-SHA-256 à 310 000
itérations enveloppe sa clé de données; ni la phrase secrète ni une valeur
privée ne paraissent dans le JSON extérieur.

La restauration exige un fichier, la phrase et une confirmation explicite.
Elle valide d’abord le ciphertext, le schéma et toutes les références. Une
transaction Dexie remplace Works, bibliothèques, progression, agenda, rappels,
Reviews, sources et organisation, puis laisse l’inventaire recréer les
artefacts et tâches dérivés. Un reçu dans la transaction IndexedDB permet de
reprendre après une suspension MV3. Les anciens champs Collectif restent
lisibles pour compatibilité mais sont ignorés et jamais restaurés. Aucun fichier
ou mot de passe n’est transmis au site, au Worker, à D1, à R2 ou aux
fournisseurs.

Après un premier miss, une demande publique bornée rejoint une outbox locale
indépendante du commit de l’œuvre. Le Worker crée atomiquement la clé puis
dépose le travail dans sa Queue. Le consumer natif acquiert seul le bail,
hydrate les profils et publie avec SQL préparé seulement ceux qui correspondent
exactement, sous état `VERIFIED`. D1 ne stocke jamais l’URL du favori, son
dossier, sa progression, une décision humaine, un owner, une identité
d’installation, un diagnostic ou un secret. Le cron Agenda et le consumer
Discovery utilisent la même Queue; leur trafic fournisseur passe par la
gateway authentifiée et isolée définie par l’ADR-0051.

Les références provenant du cache vérifié suivent le même chemin d'hydratation
que les références explicites et les résultats locaux. Le secours HTTP 405
MangaUpdates conserve l'ID exact, avance par pages avec checkpoint et ne
transforme jamais une page incomplète en introuvable.
Sur `PENDING`, la tâche attend une relecture D1 sans fournisseur. Le seul client
qui possède le bail peut rechercher et conserver ses pages localement. Une
panne d'hydratation après un lookup `VERIFIED` ne déclenche pas de nouvelle
décision d'identité.

Les erreurs internes et l'indisponibilité du cache public ont des motifs distincts
des pannes fournisseurs. Une tâche valide conserve une reprise datée même
après une erreur interne. L'échec d'inventaire reste signalé au réveil, mais
la résolution des sources déjà importées est exécutée avant ce signalement.
La restauration sync conserve les indices différés et poursuit les identités
des autres fournisseurs, avec au plus deux appels d'hydratation par tranche.

Les formes racine `/titre/chapter-12` et `/titre-chapter-12` apportent une
preuve de sortie même sans catégorie. Elles restent de type inconnu en
l'absence de règle exacte. Les liens racine ordinaires restent exclus.
La pagination MangaDex utilise les champs officiels `limit`, `offset` et
`total`; toute page incohérente reste réessayable. Une limite locale de
candidats ne constitue jamais une preuve de fin de recherche.

Le parser v4 relie structurellement le nom du favori au slug stable. Quand le
nom contient plusieurs segments, l'unique segment humain dont la forme
normalisée correspond au slug devient l'identité; progression, marque du
lecteur et texte marketing restent hors du titre sans liste de sites écrite en
dur. Un préfixe numérique de routage long n'est retiré qu'avec une sortie
prouvée par l'URL et la même identité corroborée par le nom. Les nombres
intrinsèques sont conservés. Un slug opaque accompagné de plusieurs segments
humains non concordants reste sans identité plutôt que de choisir arbitrairement.
Une route numérique courte placée avant un slug portant une sortie, comme
`/1/oeuvre-chapter-18`, suit la même règle de corroboration : le slug nettoyé
est retenu seulement si un segment humain du favori lui correspond exactement.
Le titre et le slug bruts restent dans l'artefact local pour expliquer la
décision et permettre un reparsing versionné.

La candidate locale 1.0.24 distribue `favorite-parser-v5`,
`favorite-matcher-v4` et `favorite-provider-search-v3` dans les deux manifests.
Les variantes parenthésées servent à la découverte tout en restant séparées des
preuves d'identité; les indices OVA et prépublication atteignent désormais le
runner MV3. Elle conserve le modèle cache-first, la reconstruction
`storage.sync` v2 et le stockage IndexedDB v14; aucun schéma D1 ou IndexedDB ne
change et les décisions humaines restent préservées.

La candidate 1.0.25 conserve cette reconstruction et accélère uniquement sa
lecture locale. Un démarrage normal reprend les tâches dues sans forcer
l'inventaire ni la réparation globale. Le bootstrap utilise les comptes indexés
observé, résolu et non pris en charge; le catalogue charge les `Work` et
artefacts avec `bulkGet` et les progressions avec `anyOf(workIds)`, par lots de
cent identifiants. D1 et les fournisseurs ne sont jamais contactés par une
lecture de bibliothèque.

Lorsqu'un reparsing modifie l'empreinte sémantique, une ancienne décision
automatique, y compris une Review automatique déjà résolue, est détachée de la
source et retirée de la projection visible si aucune autre source observée ne
référence son Work. L'ancienne source, sa Review, son artefact et sa tâche sont
conservés dans un reçu de correction; la nouvelle résolution repart en `READY`.
Une décision humaine résolue ou no-match reste autoritaire et n'est jamais
invalidée par ce mécanisme.

Les liens MangaUpdates modernes fournis par MangaDex sont conservés comme
références publiques validées et utilisés pour hydrater exactement la source
principale. Les anciens IDs décimaux ne sont pas convertis en IDs API.
Cette préférence s'applique aux sources explicites, aliases locaux, réponses
du snapshot synchronisé, du cache D1 vérifié et des recherches. Chaque checkpoint est lié au digest de sa requête;
résolution et enrichissement disposent de tranches distinctes pour les cinq
fournisseurs. Une panne primaire conserve la reprise datée.

Les réponses fournisseur sont limitées à 512 KiB, vérifiés sur les octets lus
et l'en-tête déclaré. La limite de transport WebBridge reste 64 KiB. Une
requête publique MangaDex de 20 résultats mesurée pendant l'audit produisait
119 663 octets : la précédente limite de 64 KiB rejetait des pages valides.

La Bibliothèque lit toutes ses identités par transactions de 100 œuvres,
puis filtre et trie globalement avant de projeter 24 entrées. Un curseur après
500 reste valide. Sa réparation ajoute uniquement des œuvres liées à une
source observée résolue; une fiche issue seulement de sync reste un cache.
Chaque lot réparé est conservé après interruption et la reprise est idempotente.
Le site relit sa page toutes les 15 secondes lorsqu'il est visible, sans
requête concurrente et sans appliquer une ancienne réponse après un changement
de filtres. Les lectures portent sur l'appartenance locale au début du parcours;
les ajouts concurrents apparaissent au rafraîchissement suivant.

Le secours cover utilise `/v1/media/provider-covers/:provider/:id/cover-md`.
L'ID public est validé avant une lecture R2 précise; aucun titre, URL de
favori ou paramètre de téléchargement n'est accepté. L'ingestion opérationnelle
d'un master autorisé peut associer cet ID au digest et au format du master.
L'association JSON est limitée à 4 KiB; sa mise à jour conditionnelle sur ETag
détecte les écritures concurrentes. Une interruption après le master se reprend
sans réécrire celui-ci. Le Worker redirige vers ses variantes fixes existantes.
La carte tente sa cover fournisseur puis ce secours une seule fois, conserve
son échec lors d'un rafraîchissement et réessaie si les références changent.
Sans association ingérée, R2 répond 404; cette correction n'affirme pas que le
catalogue de covers est déjà peuplé ou publié.

La migration de métadonnées MangaDex→MangaUpdates conserve l'identité locale
d'une œuvre existante et ses références. La lecture suivante reconnaît la
référence MangaDex liée dans le cache primaire, sans créer de doublon. Les
schémas de messages Bibliothèque acceptent les compteurs et curseurs au-delà
de 500; la limite de 24 éléments par réponse reste inchangée.

La reconstruction est terminée seulement quand :

- tout événement favori atteint un état terminal ou une reprise datée;
- chaque transformation est visible dans un artefact local versionné;
- le parser et le matcher sont purs et couverts par la matrice canonique;
- le corpus synthétique couvre les 82 cas dont MangaDex X-01 et toute divergence
  exige une décision versionnée;
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
