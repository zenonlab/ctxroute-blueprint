# Contrat du parser et de la résolution des favoris

- Statut : canonique pour la reconstruction
- Version du contrat : 2
- Date de l’audit comportemental : 2026-09-07
- Décision associée : [ADR-0037](../decisions/ADR-0037-favorite-analysis-contract.md)
- Dataflow associé :
  [`favorite-resolution.dataflow.json`](../architecture/src/favorite-resolution.dataflow.json)

## But

Ce document fige les comportements utiles observés dans l’ancien moteur FavLib
avant toute réécriture dans TobiRink. Il décrit le résultat attendu, les preuves
à conserver et les défauts à ne pas reproduire. Il ne rend pas le code FavLib
exécutable, ne copie aucune donnée utilisateur et ne change pas l’autorité des
données privées.

Les termes normatifs `DOIT`, `NE DOIT PAS` et `PEUT` s’appliquent à la future
implémentation TobiRink. La colonne de disposition utilise :

- `CONSERVER` : comportement métier à reproduire avec des tests ;
- `CORRIGER` : intention utile dont l’implémentation FavLib était trop large,
  implicite ou couplée ;
- `REJETER` : comportement ou architecture à ne pas reprendre.

## Sources comportementales auditées

L’audit a porté sur les modules FavLib de parsing, résolution navigateur,
matching fournisseur, transport fournisseur, file durable, base locale,
background MV3 et oracle de régression. Les références courtes employées dans
les matrices sont :

| Référence | Portée auditée |
| --- | --- |
| `FP` | `packages/metadata/src/bookmark-parser.ts` et ses tests |
| `SI` | `packages/metadata/src/index.ts`, particulièrement préparation des titres et `sourceIdentityFromUrl` |
| `BR` | `packages/metadata/src/browser-resolver.ts` et ses tests |
| `PM` | `packages/metadata/src/provider-title-v17.ts` et ses tests |
| `PT` | transport direct AniList/MangaUpdates et tests associés |
| `DQ` | `apps/extension/src/browser-resolution-queue.ts` et task runner durable |
| `BG` | événements et coordinateur du background MV3 |
| `OR` | `scripts/verify-parser-oracle.mjs` et son corpus synthétique |
| `A87` | ADR FavLib 0087 et wave du resolver local |

Ces chemins sont des preuves d’audit historiques. TobiRink ne dépendra pas du
répertoire FavLib à l’exécution, au build ou dans ses tests.

## Frontières et autorités

1. IndexedDB reste la seule autorité privée TobiRink pour `FavoriteSource`,
   `Review`, `Work`, bibliothèque, progression, agenda et tâches durables.
2. Les favoris navigateur sont une entrée d’import et, si activé séparément,
   une projection sortante. Leur identifiant et leur URL ne deviennent jamais
   l’identité d’une œuvre.
3. Le parser est pur et déterministe. Il ne lit ni navigateur, ni IndexedDB, ni
   réseau, ni horloge.
4. Les adaptateurs d’URL extraient seulement des preuves structurelles. Ils ne
   choisissent jamais un résultat fournisseur.
5. Le resolver reçoit un artefact immuable du parser. Il ne réinterprète pas le
   titre brut avec une seconde politique concurrente.
6. Le réseau fournisseur reste derrière des ports et une file durable. React
   et les pages web n’appellent jamais directement un fournisseur.
7. Une seule correspondance fournisseur distincte peut être automatique.
   Zéro correspondance, plusieurs correspondances ou un conflit vont en
   `Review` sans tri implicite.
8. Les décisions Review sont des mutations locales confirmées. La contribution
   collective reste un consentement séparé, révocable et désactivé par défaut.

## Pipeline canonique

Le flux cible est le suivant :

1. capturer l’identifiant externe, le titre brut, l’URL brute, le chemin de
   dossier, l’ordre entre frères et la date d’observation ;
2. qualifier l’URL et sa disposition sans modifier les valeurs brutes ;
3. extraire une preuve de source versionnée ;
4. produire un artefact de parsing versionné et une empreinte de fraîcheur ;
5. persister l’entrée et la tâche avant toute requête fournisseur ;
6. router vers le ou les fournisseurs compatibles ;
7. comparer les candidats avec une politique symétrique et déterministe ;
8. persister la résolution unique ou publier une Review explicite ;
9. hydrater par identifiant exact dans une tâche distincte ;
10. recalculer les projections locales de façon idempotente.

## Entrée favorite et disposition URL

### Valeurs brutes obligatoires

Le parser reçoit au minimum `title` et `url`. L’import conserve aussi
`externalBookmarkId`, `folderPath`, `siblingOrder` et `observedAt`. `title` et
`url` conservent exactement la chaîne JavaScript reçue ; les formes normalisées
ne les remplacent jamais. Le navigateur ne fournit pas les octets d’origine :
parler d’une conservation « octet pour octet » serait donc une promesse
incorrecte. Toute empreinte encode explicitement les chaînes en UTF-8 avec leur
longueur avant concaténation.

Le contrat d’observation borne la chaîne URL mais ne valide ni sa syntaxe ni son
schéma. Cette responsabilité appartient exclusivement à la qualification afin
que `INVALID_URL` et `NON_WEB_URL` restent représentables. Un artefact portant
un tel brut exige la disposition correspondante et aucune preuve d’identité
actionnable.

### Qualification

| Règle | Disposition | Preuve |
| --- | --- | --- |
| Accepter uniquement `http:` et `https:` | CONSERVER | `FP`, `BR`, `SI` |
| Refuser une URL invalide avec un diagnostic stable | CONSERVER | `BR`, `SI` |
| Exclure la racine, recherche, connexion, compte, réglages, genres et tags | CONSERVER | `SI` |
| Exclure les index de catalogue tels que `/catalogue/` et `index.php` ou `index.html` | CONSERVER | `SI` |
| Ne pas classer un chemin `drama` comme manga sans marqueur anime/manga/manhwa/manhua/webtoon | CONSERVER | `SI` |
| Garder une URL média non reconnue en Review, jamais comme œuvre résolue | CONSERVER | `SI` |
| Déduire `MANGA` par défaut de toute route générique | REJETER | `SI`, corrigé par `BR` |
| Conserver `UNKNOWN` pour une route générique ou un type non prouvé | CONSERVER | `BR` |
| Refuser un slug vide, purement numérique ou réduit à un mot de structure | CONSERVER | `BR`, `SI` |
| Décoder chaque segment séparément et conserver le segment brut si le décodage échoue | CONSERVER | `FP`, `BR`, `SI` |

La liste des segments structurels comprend notamment `catalogue`, `title`,
`anime`, `manga`, `manhwa`, `manhua`, `webtoon`, `series`, `read`, `comic`,
`season`, `saison`, `chapter`, `chapitre`, `episode`, ainsi que les marqueurs
de langue ou de piste. Ils servent à interpréter une route et ne sont pas des
titres à eux seuls.

## Preuve de source

La preuve de source est un objet séparé et versionné :

| Champ | Contrat |
| --- | --- |
| `key` | clé locale de corrélation, jamais identifiant de `Work` |
| `title` | titre dérivé de la route ou prouvé par le titre humain |
| `type` | `ANIME`, `MANGA`, `MANHWA`, `MANHUA` ou `UNKNOWN` |
| `rawSlug` | segment exact observé avant nettoyage |
| `stableSlug` | slug d’identité seulement après preuve suffisante |
| `canonicalUrl` | URL d’identité sans suffixe de sortie ; elle conserve l’origine observée valide |
| `releaseSuffix` | fragment de sortie séparé de l’identité |
| `release` | valeur brute, nombre éventuel, nature et provenance route/suffixe |
| `season` | saison explicitement libellée par l’URL, jamais nombre nu |
| `strategy` | adaptateur structurel ou extraction générique |
| `evidence` | codes de preuve tels que route de catégorie, route de sortie, suffixe ou saison explicite |
| `aliases` | aliases déjà établis avec leur provenance |

Lorsque `origin` et `canonicalUrl` existent ensemble, leurs origines URL
normalisées doivent être égales. Une preuve rejetée conserve sa disposition et
ses diagnostics, mais aucun type média, alias, identifiant, chemin canonique,
saison ou sortie exploitable.

Règles de route à conserver :

- une catégorie explicite suivie d’un slug fournit `CATEGORY_PATH` ;
- un segment `chapter-12`, `episode-7`, `volume-3` ou équivalent peut fournir
  `RELEASE_PATH` et le segment précédent comme candidat d’identité ;
- un suffixe de sortie attaché au slug fournit `RELEASE_SUFFIX` ;
- une route peut contenir un slug stable puis un slug de sortie plus lisible ;
  les deux restent distincts et le second ne remplace pas le premier sans
  preuve humaine ;
- le type vient du chemin, pas du nom de domaine. Un hostname contenant
  « anime » ne transforme pas une route `scan` ou `manga` en anime ;
- `manhwa` et `webtoon` précèdent `manga`, puis `manhua`, dans la
  classification explicite ;
- une saison d’anime n’existe que si un marqueur libellé est présent ;
- une URL canonique ne force pas artificiellement HTTPS et ne retire pas un
  préfixe de hostname versionné sans règle d’adaptateur explicitement testée.

Le dernier point corrige FavLib : une normalisation de présentation ne doit pas
fabriquer une autre origine réseau.

## Artefact de parsing immuable

L’artefact cible contient au minimum :

- identifiant et version du parser d’identité ;
- version du parser de progression et du matcher ;
- empreinte stable calculée sur titre brut, URL brute et versions du parser et
  de l’adaptateur de source ;
- `raw.title` et `raw.url` inchangés ;
- provenance brute et liste ordonnée des transformations d’identité ;
- preuve de source utilisée ;
- segments du titre avec valeur brute, valeur nettoyée, transformations et
  motif d’exclusion éventuel ;
- identité ou `null` ;
- titre d’affichage ou `null` ;
- preuve de saison séparée ;
- progression ou `null` ;
- statut `parsed` ou `identity-missing` ;
- diagnostics stables ;
- tous les candidats de progression et tous les candidats rejetés.

L’empreinte sémantique couvre uniquement le titre brut, l’URL brute et les
versions du parser et de l’adaptateur de source. `observedAt`, `folderPath`,
`siblingOrder` et le type de déclencheur appartiennent à la révision
d’observation : leur changement ne relance pas une résolution fournisseur.

L’empreinte historique FNV-1a sert seulement à détecter un artefact obsolète.
Elle n’est ni une signature, ni un MAC, ni une preuve de sécurité. TobiRink
PEUT conserver cet algorithme pour la compatibilité oracle ou adopter une
empreinte différente en incrémentant explicitement la version.

### Vocabulaires fermés à préserver

| Famille | Valeurs auditées |
| --- | --- |
| Méthodes de match | `source-id`, `source-url`, `ordered-exact`, `explicit-season`, `reordered-significant-words`, `bounded-edit-distance` |
| Décisions de match | `MATCH`, `AMBIGUOUS`, `NO_MATCH` |
| Preuves de progression | `explicit-marker`, `labelled-url-path`, `separated-release`, `season-divergence`, `bare-number-after-validated-identity`, `numeric-url-segment-after-source-identity` |
| Rejets de progression | `INCOMPATIBLE_KIND`, `EXPLICIT_EVIDENCE_PRESENT`, `LOWER_QUALITY_EVIDENCE`, `EARLIER_SAME_QUALITY_EVIDENCE` |
| Transformations d’identité | `numeric-routing-prefix`, `language-marker`, `reader-brand-suffix`, `opaque-url-slug-replaced`, `repeated-human-title` |
| Transformations de segment | `excluded_progression`, `excluded_numeric`, `excluded_release_marker`, `excluded_observed_hostname`, `cleaned_generic_suffix` |
| Provenance d’alias | `stable-url-slug`, `aligned-bookmark-segment` |
| Diagnostics d’identité | `OPAQUE_IDENTITY_UNCORROBORATED`, `URL_IDENTITY_MISSING` |
| Diagnostics de pipeline | `INPUT_LIMIT_EXCEEDED`, `SOURCE_ADAPTER_CONFLICT`, `INCOMPLETE_CANDIDATE_SET`, `BLOCKED_CONTENT_TAXONOMY` |
| Preuves de route | `CATEGORY_PATH`, `TITLE_SLUG`, `RELEASE_SUFFIX`, `RELEASE_PATH`, `EXPLICIT_URL_SEASON` |
| Provenance de sortie URL | `URL_PATH`, `URL_SLUG_SUFFIX` |
| Disposition URL | `INVALID_URL`, `NON_WEB_URL`, `UTILITY_PAGE`, `ROOT_PAGE`, `URL_IDENTITY_UNRESOLVED` |
| Méthodes de langue | `url-path`, `manifest`, `document`, `html-lang`, `content-language`, `og:locale`, `hreflang`, `statistical`, `undetected`, `ambiguous` |
| Conflits de langue | `strong-statistical`, `strong-strong`, `detector-detector`, `weak-weak` |
| Opérations durables pertinentes | `RESOLVE`, `HYDRATE`, `SUBMIT_REVIEW` |
| États durables | `READY`, `CLAIMED`, `EFFECT_RECORDED`, `COMMITTED`, `RETRY_AT`, `BLOCKED` |

Un renommage, ajout ou retrait dans ces vocabulaires est un changement de
contrat. La future implémentation peut choisir des identifiants internes
différents seulement si sa couche de migration et son oracle rendent la
correspondance explicite.

## Normalisation de titre

La normalisation partagée DOIT :

1. appliquer Unicode NFKD ;
2. retirer les marques combinées ;
3. passer en minuscules de manière stable ;
4. remplacer toute suite hors lettres/nombres par un espace ;
5. réduire les espaces et rogner les extrémités.

La clé compacte retire ensuite les espaces. Les tokens significatifs excluent
les mots outils et les marqueurs de sortie, notamment `the`, `a`, `an`, `of`,
`and`, `et`, `de`, `la`, `le`, `les`, `des`, `episode`, `chapter`,
`chapitre`, `saison`, `season`, `vostfr`, `vf`, `vo`, `sub` et `dub`.

Cette normalisation sert à comparer. Elle ne remplace jamais le titre brut ou
la ponctuation utile du titre d’affichage.

## Nettoyage du titre de favori

Les transformations sont ordonnées, limitées et enregistrées :

1. réduire les espaces ;
2. retirer en tête `read`, `watch`, `lire`, `regarder` et la variante
   « regarder gratuitement » ;
3. retirer un badge initial parenthésé OAV/OVA/langue/piste seulement s’il
   contient une preuve explicite telle que VOSTFR, VF, VO, sub ou dub ;
4. retirer les suffixes explicites chapitre/épisode/volume avec entier ou
   décimal, y compris virgule décimale ;
5. retirer un nombre séparé suivi d’une langue ou piste ;
6. retirer les queues marketing reconnues : `online free`, `free online`,
   `read online`, `in english online free`, `en hd`, « lire en ligne », et les
   badges « new chapters/chapitres/episodes/volumes/releases/sorties » ;
7. retirer les marqueurs terminaux de langue, piste ou scan ;
8. retirer le nom du site lorsqu’il constitue un segment séparé et correspond
   au hostname observé ;
9. retirer les délimiteurs terminaux ;
10. répéter le nettoyage au plus cinq fois, avec arrêt dès stabilité ;
11. dédupliquer des segments humains égaux sans perdre leur provenance.

Les séparateurs reconnus sont `|`, `·`, tiret cadratin, demi-cadratin et tiret
entouré d’espaces. Deux-points et ponctuation interne appartiennent au titre
tant qu’ils ne prouvent pas une sortie.

Le parser NE DOIT PAS :

- retirer un nombre intrinsèque à une identité déjà validée ;
- transformer une année parenthésée ou terminale en progression ;
- retirer un ordinal comme `2nd`, `1st`, `3rd`, `4th`, `1er`, `2e` ou `2ème` ;
- retirer un mot de titre seulement parce qu’il ressemble à `sub`, `dub`,
  `scan`, `season` ou un marqueur de sortie ;
- accepter une extension de sous-titre, un préfixe, un stemming ou une simple
  inclusion comme preuve d’identité ;
- faire entrer un chapitre, épisode, volume, nombre nu, langue ou hostname
  dans les aliases d’identité.

Une année terminale explicite peut être extraite dans un champ `year` de
provenance pour filtrer des candidats, mais sa suppression du titre d’affichage
ne prouve aucune identité.

## Construction de l’identité

### Segments

Chaque segment est classé comme humain, progression, nombre isolé, marqueur de
sortie ou hostname observé. Les segments exclus restent dans l’artefact avec
leur valeur brute et un motif. La progression est supprimée avant la création
de tout alias.

### Slug stable et corroboration

Un `rawSlug` ne devient `stableSlug` nettoyé que si exactement une preuve
humaine établit l’identité restante :

- une séquence de tokens du titre humain doit apparaître exactement une fois
  dans le slug ;
- un préfixe structurel est admissible seulement s’il est composé d’un nombre
  de routage puis d’un marqueur de langue ;
- un suffixe de lecteur est admissible seulement s’il correspond exactement
  au contenu d’un crochet terminal du titre humain ;
- toutes les suppressions sont consignées comme `numeric-routing-prefix`,
  `language-marker` ou `reader-brand-suffix` ;
- un slug alphanumérique opaque, seul ou précédé de composants techniques,
  n’est remplacé que par un unique segment humain nettoyé ;
- un slug opaque sans corroboration produit
  `OPAQUE_IDENTITY_UNCORROBORATED` ;
- un préfixe numérique lisible n’est retiré que si un titre humain unique le
  contredit. Des titres réels commençant par un nombre restent intacts ;
- deux segments humains répétés peuvent corriger un titre source pollué, avec
  transformation `repeated-human-title` ;
- sans preuve de source suffisante, l’identité reste absente avec
  `URL_IDENTITY_MISSING`.

Les aliases portent une provenance fermée : `stable-url-slug` ou
`aligned-bookmark-segment`. La valeur source stable est première ; un segment
humain aligné peut être ajouté seulement s’il est distinct.

Le titre d’affichage préfère l’identité prouvée par la source. À défaut, il
prend le premier segment humain nettoyé, puis le titre générique nettoyé. Une
étiquette composée uniquement d’une sortie ne remplace jamais le titre de la
source.

## Saison d’anime

La saison est une identité de partie, distincte de la progression de sortie.

### Marqueurs explicites

Les formes reconnues incluent `S4`, `Season 4`, `Saison 4`, `4th Season` et
les libellés traduits `temporada`, `stagione`, `staffel`, `seizoen`, `sesong`,
`säsong`, `kausi`, `sezon`, `sezona`, `sezonas` et `сезон`. Les séparateurs
espace, tiret, point et underscore sont admis. Une saison doit être un entier
strictement positif sur un ou deux chiffres.

Dans une URL, les formes compactes `season4`, `saison4` et un libellé attaché
au slug peuvent constituer une preuve. Le segment exact est conservé. Un nombre
nu terminal ne constitue jamais une saison.

### Décision

- un nombre nu final est conservé comme `bare-trailing-number`, jamais comme
  saison automatique ;
- une saison du titre ne correspond à une saison fournisseur que si le titre
  de base et le numéro sont tous deux corroborés par des marqueurs explicites ;
- pour AniList, un candidat de saison libellé ne peut pas être sélectionné par
  le matching de tokens qui considère `season` comme non significatif ;
- une saison URL et une saison titre égales donnent une preuve non conflictuelle ;
- des saisons différentes produisent `conflict: true` et aucune saison
  canonique inventée ;
- une saison sans numéro de sortie laisse la progression à `null`.

Les chiffres romains I à X observés dans l’ancien helper ne deviennent une
saison qu’avec un libellé ou une règle explicitement versionnée. La conversion
générale d’un dernier chiffre romain en saison est `REJETÉE`, car elle peut
modifier une identité légitime.

## Progression

### Forme

Une progression contient :

- `kind` : `chapter`, `episode` ou `volume` ;
- `number` : nombre fini supérieur ou égal à zéro ;
- `raw` : écriture numérique originale ;
- saison, numéro local ou global seulement lorsqu’ils sont prouvés ;
- provenance complète : source, classe de preuve, titre/URL d’entrée, titre
  nettoyé, slug, segments de chemin, suffixe, alias et méthode de match,
  saisons URL/titre, tous les candidats, tous les rejets et version du parser.

Les points et virgules décimaux sont acceptés. La nature par défaut dépend du
type prouvé : anime donne un épisode ; manga, manhwa et manhua donnent un
chapitre. Un volume exige son libellé.

### Classes de preuve et priorité

| Priorité | Classe | Exemple structurel |
| ---: | --- | --- |
| 5 | `explicit-marker` | chapitre/épisode/volume libellé dans le titre |
| 4 | `labelled-url-path` | segment URL ou suffixe libellé |
| 3 | `separated-release` | nombre séparé accompagné d’une langue/piste |
| 2 | `season-divergence` | nombre adjacent à une identité validée avec conflit de saisons |
| 1 | `bare-number-after-validated-identity` | nombre adjacent après preuve du titre |
| 1 | `numeric-url-segment-after-source-identity` | segment terminal entièrement numérique après preuve d’identité |

La qualité décide avant la position. À qualité égale, la dernière occurrence
gagne. La grandeur numérique ne décide jamais : `chapitre 11` peut donc gagner
sur un `chapitre 108` antérieur de même classe.

### Garde-fous

- un nombre URL nu est admissible uniquement comme segment terminal complet et
  après preuve de l’identité source ;
- un nombre incorporé dans un slug, une année ou un identifiant de routage
  n’est pas une progression ;
- un numéro égal à une saison prouvée dans `/season/2` n’est pas une sortie ;
- un nombre adjacent au titre exige une correspondance validée contre un alias ;
- l’identité peut précéder ou suivre le nombre ;
- les aliases personnels courts sont admis seulement s’ils sont déjà établis ;
- un ordinal reste dans l’identité ;
- une page d’œuvre ou de saison sans sortie prouvée retourne `null` ;
- les valeurs négatives, infinies et non numériques sont ignorées.

Chaque candidat non choisi porte exactement un motif :

- `INCOMPATIBLE_KIND` si sa nature diffère du candidat retenu ;
- `EXPLICIT_EVIDENCE_PRESENT` si une preuve explicite domine une preuve nue ;
- `LOWER_QUALITY_EVIDENCE` si sa classe a une priorité moindre ;
- `EARLIER_SAME_QUALITY_EVIDENCE` si une occurrence ultérieure de même qualité
  a été retenue.

## Matching fournisseur

### Routage

- une URL officielle AniList `/anime/{id}` ou `/manga/{id}` fournit un ID
  numérique exact et le type correspondant ;
- une URL MangaUpdates `/series/{id}` fournit un ID ASCII alphanumérique exact ;
- `ANIME` interroge AniList ;
- `MANGA`, `MANHWA` et `MANHUA` interrogent MangaUpdates ;
- `UNKNOWN` reste inconnu et peut interroger les deux fournisseurs dans des
  tâches séparées et bornées ;
- les candidats AniList non anime et les candidats MangaUpdates anime sont
  incompatibles, sauf opération AniList explicitement destinée au manga ;
- les marqueurs OVA et pré-sérialisation exigent une compatibilité symétrique
  entre preuve source et format/titre candidat. Ils ne servent jamais de score.

### Ordre de décision

Pour chaque niveau, les candidats sont d’abord dédupliqués par identifiant. Le
niveau retourne `MATCH` pour un seul identifiant distinct, `AMBIGUOUS` pour
plusieurs et passe au niveau suivant seulement si aucun candidat ne correspond.

1. identifiant fournisseur exact issu de l’URL ;
2. URL fournisseur exacte lorsqu’elle est disponible ;
3. titre normalisé exact, ordre des mots conservé ;
4. saison anime explicitement corroborée ;
5. même multiensemble de tokens significatifs, ordre libre ;
6. distance d’édition bornée sur les clés compactes.

Pour la distance, la borne est
`min(2, floor(max(longueurGauche, longueurDroite) / 8))`. Une borne nulle
interdit ce niveau. Une borne demandée négative ou non entière est invalide.

Le matcher est identique pour AniList et MangaUpdates. Il NE DOIT PAS utiliser
l’ordre de réponse, la popularité, le rang, la note, la date, l’image, la
richesse de la fiche, un préfixe partiel, un sous-titre isolé, le stemming ou la
couverture de tokens pour départager.

Les anciens helpers `SUBTITLE_EXACT`, `PARENTHESIZED_EXACT` et
`ALIAS_PARENTHESIZED_EXACT` ne sont pas des preuves automatiques. Une variante
parenthésée ou un sous-titre peut devenir un alias seulement par une étape de
préparation versionnée qui conserve sa provenance ; elle repasse ensuite par
la politique commune.

## Langue, format et taxonomie

Ces signaux ont été trouvés à côté du parser. Ils ne modifient pas l’identité
silencieusement, mais doivent rester disponibles pour qualifier un candidat ou
une source.

### Langue

Une locale valide comporte deux ou trois lettres, puis éventuellement une
région ou variante séparée par `-` ou `_`. La langue primaire est en minuscules
et une région de deux lettres en majuscules. La comparaison de préférence
porte sur la langue primaire.

L’arbitrage FavLib observé est conservé comme contrat d’enrichissement :

1. les segments de langue dans l’URL et `Content-Language` sont des preuves
   fortes ;
2. le manifeste, `html[lang]`, `og:locale` et `hreflang` sont faibles ;
3. au plus 24 déclarations sont conservées et chaque valeur brute est limitée
   à 160 caractères ;
4. le texte visible exclut `script`, `style`, `noscript`, `template` et `svg` ;
5. aucune détection statistique n’est acceptée sous 80 caractères nettoyés ;
6. le détecteur franc-min exige une confiance d’au moins 0,8 et une marge d’au
   moins 0,1 ; ELD doit déclarer son résultat fiable ;
7. deux détecteurs fiables en désaccord, deux preuves fortes distinctes ou une
   preuve forte opposée aux statistiques donnent `ambiguous` ;
8. une statistique fiable peut battre des déclarations faibles génériques ;
9. si les statistiques sont absentes, une seule langue faible cohérente peut
   être utilisée ; sinon le résultat est `undetected` ou `ambiguous` ;
10. l’URL brute, la méthode, la date, les déclarations, scores et conflits
    restent dans la provenance.

Ce détecteur de document nécessite HTML et bibliothèques statistiques. Il reste
hors du parser pur de favoris et hors du chemin initial de résolution. Une
simple langue présente dans le titre ou le slug est seulement un marqueur de
structure, pas une preuve de langue de l’œuvre.

### Format anime et pré-sérialisation

Une source portant explicitement `OVA` n’accepte qu’un candidat AniList de
format OVA ; une source sans OVA rejette un candidat OVA automatique. De même,
une source marquée « pre-serialization/pre-serialisation » exige le marqueur
équivalent chez le candidat, et une source ordinaire rejette ce candidat. Des
parenthèses ordinaires ne déclenchent pas cette règle.

### Taxonomie bloquée

Le filtre de contenu compare exactement les libellés fournisseur après NFKD,
retrait des accents, casse et ponctuation. Il conserve le champ, la valeur
brute et la valeur normalisée dans `BLOCKED_CONTENT_TAXONOMY`.

Les genres historiques fermés sont `Adult`, `Erotica`, `Hentai` et `Smut`.
Les catégories historiques fermées sont `18+`, `Adult`, `Erotica`,
`Explicit Sex`, `Explicit Sexual Content`, `Graphic Sex`, `Hardcore`,
`Hentai`, `Lolicon`, `Pornographic Content`, `Pornography`, `Sexual Content`,
`Shotacon` et `Smut`. Une catégorie contenant seulement un de ces mots, telle
qu’un libellé plus long non identique, ne doit pas être bloquée par inclusion.

Le filtre est une règle éditoriale après hydratation, jamais une preuve de
matching. Toute évolution de la liste exige une décision produit distincte.

### Adaptateurs legacy hors résolution cible

FavLib contenait aussi un adaptateur MangaDex : UUID strict, recherche par titre
limitée à 20, aliases multilingues, lien MangaUpdates public facultatif,
matching symétrique commun et refus d’utiliser `lastChapter`/`lastVolume` comme
autorité de progression. Ces invariants restent documentés, mais MangaDex
n’appartient pas au routage cible AniList/MangaUpdates de cette reconstruction.
L’ajouter comme fournisseur exigerait une étape et des permissions séparées.

Le mapping adjacent de statut ramenait `hiatus` vers `Hiatus`,
`complete/completed/finished` vers `Completed`,
`cancelled/canceled/discontinued/dropped` vers `Cancelled`, et
`ongoing/releasing/not yet released/upcoming/planned` ou inconnu vers
`Ongoing`. Ce mapping concerne l’hydratation publique, pas le parser
d’identité ; il devra vivre dans son propre module versionné.

## Transport et hydratation

Les paramètres FavLib suivants sont des références comportementales à
conserver ou à redécider explicitement avant changement :

| Élément | Contrat cible | Disposition |
| --- | --- | --- |
| AniList direct | origine exacte `https://graphql.anilist.co` | CONSERVER derrière un adaptateur approuvé |
| MangaUpdates direct | origine exacte `https://api.mangaupdates.com/v1` | CONSERVER derrière un adaptateur approuvé |
| Intervalle AniList | au moins 2 200 ms entre effets réservés | CONSERVER |
| Intervalle MangaUpdates | au moins 3 000 ms | CONSERVER |
| Timeout d’une requête | 8 secondes, signal global combiné | CONSERVER |
| Batch d’IDs AniList | maximum 50 | CONSERVER |
| Taille JSON historique | maximum 2 Mio | CORRIGER par une limite propre à chaque contrat |
| Redirections HTML historiques | maximum 2 et 512 Kio | CORRIGER : hors chemin principal du resolver |
| `Retry-After` | nombre de secondes ou date HTTP fait autorité | CONSERVER |
| `X-RateLimit-Reset` | utilisé après absence de `Retry-After` | CONSERVER |
| 429 sans en-tête | différer 60 secondes | CONSERVER comme valeur versionnée |
| 403 sans en-tête | différer une heure | CONSERVER comme valeur versionnée |

Une recherche de titre demande seulement les champs nécessaires au matching.
L’hydratation complète arrive après une décision par ID exact, possède ses TTL
positif/négatif et ne relance jamais le matching de titre.

Une réponse de recherche porte obligatoirement `complete` et `truncated`. Un
ensemble incomplet, tronqué ou dont une page manque ne peut jamais produire
`MATCH`, même si un seul candidat visible correspond. Il produit une erreur
récupérable `INCOMPLETE_CANDIDATE_SET`, puis `BLOCKED` si la politique de retry
est épuisée. `AMBIGUOUS` reste réservé à plusieurs identifiants distincts dans
un ensemble complet.
La limite de vingt candidats est un budget de transport, pas une preuve que le
vingt-et-unième candidat n’existe pas.

Les caches d’adaptateur sont locaux et versionnés. Une hydratation positive
expire au plus tard après 24 heures et une absence après 15 minutes. Une entrée
expirée peut accélérer un affichage local existant, mais ne peut pas décider une
nouvelle identité sans revalidation.

## File durable et suspension MV3

Chaque tâche conserve : identifiant stable, version, opération, entrée figée,
clé d’idempotence, état, curseur, tentative, expiration de claim, résultat ou
digest, `availableAt` toujours défini et erreur structurée.

Les tâches de résolution vivent dans une outbox du même schéma
`tobirink-private` que `FavoriteSource`, `Review` et les artefacts. L’import de
ces quatre écritures est une seule transaction Dexie. La base technique
`tobirink-durable-tasks` déjà utilisée pour les notifications Agenda reste une
file distincte : elle n’est pas réutilisée pour la résolution et ne peut pas
rompre l’atomicité de l’import.

Le cycle cible est `READY → CLAIMED → EFFECT_RECORDED → COMMITTED`, avec
`RETRY_AT` et `BLOCKED` non terminaux. Un claim expiré est rejoué avec la même
clé d’idempotence. L’entrée brute est persistée avant toute requête.

La sémantique réseau est au moins une fois. Une coupure après envoi peut rejouer
la requête ; toutes les écritures locales doivent donc être des upserts
déterministes. Aucun mutex, timer, tableau ou `Promise` uniquement en mémoire
ne peut porter l’état unique.

Les opérations de résolution, hydratation et contribution Review sont
distinctes. Une tâche de résolution est idempotente sur l’identifiant du
favori, l’empreinte des entrées et la version du matcher. L’enqueue batch :

- lit une fois l’index des clés déjà présentes ;
- construit une tranche bornée ;
- écrit la tranche en transaction ;
- en cas de course d’un autre réveil MV3, relit une fois puis écrit seulement
  les clés encore absentes ;
- échoue explicitement si la seconde écriture ne converge pas.

Un réveil traite au plus huit tâches et s’arrête après 20 secondes de temps
réel, même si le lot n’est pas terminé. Un claim expire après 60 secondes. Une
tâche transitoire effectue au plus huit tentatives automatiques ; elle devient
ensuite `BLOCKED` et exige un retry manuel explicite. Le backoff exponentiel
part de 30 secondes, est plafonné à 6 heures et son jitter de 0 à 10 % est
calculé puis persisté une seule fois. `Retry-After`, `X-RateLimit-Reset` et les
délais 403 définis plus haut priment sur ce calcul.

Chaque fournisseur possède une lane avec au plus un effet en vol et sa cadence
monotone : 2 200 ms pour AniList, 3 000 ms pour MangaUpdates. Les deux lanes
peuvent avancer indépendamment; l’ordre de leurs réponses ne participe jamais
au matching. Les claims sont lus sans `toArray()` global par les index composés
`[kind+provider+state+availableAt]` et `[state+claimExpiresAt]`, avec
`idempotencyKey` unique. Le curseur et le checkpoint fournisseur sont écrits
avant de poursuivre.

Une résolution persiste d’abord le résultat `RESOLVED` ou `REVIEW`, l’artefact,
la décision et au plus six candidats pour une Review active. Les ensembles
complets ne sont pas archivés : seul leur digest est conservé. Une résolution
unique enfile ensuite une hydratation par ID exact.

## Événements favoris et convergence

Le coordinateur doit couvrir :

- installation et mise à jour de l’extension ;
- création d’un favori ;
- modification de son titre ou URL ;
- déplacement ou changement d’ordre ;
- suppression ;
- synchronisation ou réimport manuel explicite ;
- réveil par alarme d’une tâche arrivée à échéance ;
- reprise après redémarrage ou suspension du service worker.

Chaque événement déclenche une commande idempotente et une convergence locale.
Une suppression navigateur ne supprime jamais automatiquement `Work`,
progression ou historique Review. Elle peut marquer la source observée absente
selon une future politique explicitement approuvée.

Les listeners sont enregistrés avant l’inventaire. Comme WebExtension ne donne
pas d’identifiant d’événement stable, chaque commande reçoit une séquence locale
croissante dans IndexedDB et une révision dérivée de l’état observable. Une
tranche d’inventaire porte sa séquence de base : elle ne peut pas écraser une
création, modification, déplacement ou suppression reçue plus tard. Les
identifiants touchés pendant le scan sont réconciliés avant sa clôture.

L’inventaire complet ne doit pas être transformé par une seule opération
mémoire non bornée. La lecture, la normalisation, l’enqueue et les écritures
sont paginées ou découpées en tranches durables. Une installation avec zéro
favori admissible est un succès vide, pas une erreur. Un échec conserve la
dernière projection lisible et publie une erreur récupérable.

## Review et collectif

`MATCH` écrit une résolution locale. `NO_MATCH`, `AMBIGUOUS`, conflit de saison,
type incompatible, identité opaque non corroborée et corruption de provenance
ouvrent ou maintiennent une Review.

`NO_MATCH` écrit explicitement `Review.status = no-match`, conserve les motifs
et reste résoluble manuellement. Il ne crée aucune `Work` et ne disparaît pas de
l’historique sous prétexte que la file principale affiche seulement les Review
`pending`.

Une décision Review doit relire la Review pending, sa `FavoriteSource`, la
révision opaque et le `Work` choisi dans une seule transaction. Révision
périmée, œuvre absente, hors bibliothèque ou correspondance manuelle ambiguë
échouent sans effet.

Une contribution collective :

- n’existe qu’après consentement séparé et révocable ;
- n’est enfilée qu’après une décision locale explicite ;
- contient une clé normalisée hachée, un pseudonyme local opaque, le
  fournisseur, l’ID public et un nonce court à usage unique ;
- ne contient jamais titre, URL, source, bibliothèque, progression, compte ou
  appareil ;
- revérifie le consentement avant le challenge et avant l’envoi final ;
- bloque les tâches pending si le consentement est retiré ;
- ne transforme jamais un vote collectif en identité automatique.

Ces règles complètent l’ADR-0033 et ne réactivent aucun adaptateur distant
dormant sans permission et disclosure séparées.

## Versioning et oracle

L’ancien comportement de référence employait les marqueurs
`favorite-parser-v14`, identité 14, progression 10,
`local-title-v1`, `provider-title-v17` et `browser-resolver-v1`. Ces valeurs
sont des points de comparaison, pas les versions obligatoires du nouveau code.

Toute modification d’une règle de normalisation, identité, saison,
progression, priorité, rejet ou matching doit :

1. incrémenter le composant de version concerné ;
2. conserver l’ancienne lecture d’artefact ou fournir une migration additive ;
3. ajouter une fixture synthétique minimale ;
4. comparer l’ancien et le nouveau résultat ;
5. documenter si la divergence est une correction volontaire ;
6. invalider ou recalculer les tâches dont l’empreinte dépend de la règle.

L’oracle FavLib comparait par égalité profonde quinze artefacts synthétiques à
un commit Git figé. TobiRink doit importer le principe, pas la dépendance au
répertoire FavLib : corpus versionné dans TobiRink, sortie complète comparée et
aucun titre ou URL privé dans les fixtures.

### Contrat d’équivalence

La matrice ci-dessous contient exactement 82 cas : 77 `CONSERVER`, quatre
`CORRIGER` (`U-02`, `U-10`, `B-03`, `O-02`) et un comportement conditionnel à
un futur adaptateur (`X-01`). « Même résultat » signifie la même disposition,
identité, saison, progression, décision de matching et classe de diagnostic ;
cela ne signifie pas un JSON identique à l’ancien artefact FavLib.

L’oracle TobiRink est obligatoire avant toute composition runtime :

1. une fixture synthétique fournit l’observation et les réponses fournisseur
   normalisées, jamais un appel réseau vivant ;
2. la sortie attendue contient l’artefact complet, la décision et la projection ;
3. les 77 cas `CONSERVER` doivent être égaux au résultat comportemental audité ;
4. les quatre corrections possèdent un résultat TobiRink explicite et une
   assertion interdisant l’ancien défaut ;
5. `X-01` reste exclu du gate principal tant que MangaDex n’est pas activé ;
6. toute réponse marquée `truncated` vérifie qu’aucun `MATCH` n’est possible ;
7. une modification volontaire exige version, fixture et mise à jour de cette
   matrice avant le code.

Les protections d’infrastructure ajoutent des tests hors des 82 cas historiques :
observation à 64 Kio et au-delà, ensemble candidat incomplet, rollback de
l’outbox atomique, claim indexé sur une file volumineuse et compaction d’un reçu
terminal. Elles ne sont jamais utilisées pour annoncer une équivalence FavLib.

## Matrice exhaustive des cas de test

| ID | Cas requis | Résultat attendu | Disposition | Preuve |
| --- | --- | --- | --- | --- |
| P-01 | Accents, casse, ponctuation et espaces | même clé normalisée, brut intact | CONSERVER | `FP`, `SI`, `OR` |
| P-02 | Clé compacte | espaces retirés après normalisation | CONSERVER | `FP`, `SI` |
| P-03 | Mots réordonnés | match seulement si multiensemble significatif identique | CONSERVER | `FP`, `BR`, `PM` |
| P-04 | Une faute courte | distance bornée selon la formule | CONSERVER | `FP`, `PM` |
| P-05 | Deux candidats au même niveau | `AMBIGUOUS`, indépendamment de l’ordre | CONSERVER | `BR`, `PM` |
| P-06 | Candidat populaire non pertinent | ignoré | CONSERVER | `BR`, `PM` |
| P-07 | Préfixe ou sous-titre partiel | `NO_MATCH` | CONSERVER | `PM`, `SI` |
| P-08 | Stemming ou token coverage | `NO_MATCH` | CONSERVER | `PM` |
| L-01 | Locale URL unique | preuve forte normalisée | CONSERVER | module langue FavLib |
| L-02 | Deux locales URL | `ambiguous` | CONSERVER | module langue FavLib |
| L-03 | Texte visible trop court | aucune statistique | CONSERVER | module langue FavLib |
| L-04 | Statistiques fiables contre déclaration faible | statistique retenue | CONSERVER | module langue FavLib |
| L-05 | Statistiques fiables contre preuve forte | `ambiguous` | CONSERVER | module langue FavLib |
| F-01 | Source et candidat OVA | compatibilité symétrique requise | CONSERVER | `SI` |
| F-02 | Pré-sérialisation d’un seul côté | candidat automatique refusé | CONSERVER | `SI` |
| C-01 | Genre/catégorie bloqué exact normalisé | exclusion avec brut et normalisé | CONSERVER | `SI` |
| C-02 | Libellé contenant seulement un mot sensible | pas d’exclusion par inclusion | CONSERVER | `SI` |
| X-01 | MangaDex UUID invalide | candidat refusé | CONSERVER si adaptateur futur | `SI` |
| X-02 | MangaDex lastChapter/lastVolume | jamais progression autoritaire | CONSERVER | `SI` |
| U-01 | Route catégorie + slug | identité de source et `CATEGORY_PATH` | CONSERVER | `SI`, `BR` |
| U-02 | Route générique + sortie | type `UNKNOWN` jusqu’à preuve | CORRIGER | `BR` contre `SI` |
| U-03 | Slug purement numérique | aucune identité | CONSERVER | `BR`, `SI` |
| U-04 | URL fournisseur officielle | ID exact avant titre | CONSERVER | `BR`, `SI` |
| U-05 | Route chapitre séparée | identité précédente, sortie séparée | CONSERVER | `SI` |
| U-06 | Suffixe chapitre attaché | suffixe retiré avec provenance | CONSERVER | `SI` |
| U-07 | Hostname ressemblant à anime, route scan | type dicté par le chemin | CONSERVER | `SI` |
| U-08 | Catalogue, index, racine ou utility page | exclu avec motif stable | CONSERVER | `SI` |
| U-09 | Drama sans marqueur média | exclu | CONSERVER | `SI` |
| U-10 | Origine HTTP valide | ne pas forger HTTPS | CORRIGER | `SI` |
| T-01 | Préfixe read/watch/lire/regarder | retiré et tracé | CONSERVER | `FP`, `SI` |
| T-02 | Badge initial OAV + langue | retiré seulement avec preuve de piste | CONSERVER | `FP` |
| T-03 | Suffixe chapitre/épisode/volume | retiré du titre, conservé comme sortie | CONSERVER | `FP`, `SI` |
| T-04 | Nombre séparé + langue | sortie, pas identité | CONSERVER | `FP` |
| T-05 | Queue marketing | retirée par liste fermée | CONSERVER | `FP`, `SI` |
| T-06 | Nom du site comme segment | retiré avec hostname observé | CONSERVER | `FP`, `SI` |
| T-07 | Titre humain dupliqué | un titre, transformations conservées | CONSERVER | `FP` |
| T-08 | Mot ressemblant à sub/dub/scan | conservé sans syntaxe de sortie | CONSERVER | `SI` |
| T-09 | Ponctuation personnelle alignée | conservée pour l’affichage | CONSERVER | `SI` |
| T-10 | Année terminale | champ année, jamais progression | CONSERVER | `FP`, `SI` |
| I-01 | Slug routage + langue + titre + lecteur | nettoyer seulement avec alignement unique | CONSERVER | `FP` |
| I-02 | Slug opaque + un titre humain | remplacer et tracer | CONSERVER | `FP` |
| I-03 | Slug opaque sans titre humain | `OPAQUE_IDENTITY_UNCORROBORATED` | CONSERVER | `FP` |
| I-04 | Préfixe numérique contredit | titre humain unique gagne | CONSERVER | `FP` |
| I-05 | Préfixe numérique non contredit | reste dans l’identité | CONSERVER | `FP` |
| I-06 | Alias contenant une sortie | alias refusé | CONSERVER | `FP` |
| I-07 | Aucune preuve URL | `URL_IDENTITY_MISSING` | CONSERVER | `FP` |
| S-01 | `S4`, Season/Saison ou traduction | saison explicite | CONSERVER | `FP`, `SI` |
| S-02 | `4th Season` | saison explicite | CONSERVER | `FP` |
| S-03 | Nombre final nu | provenance seulement | CONSERVER | `FP`, `BR` |
| S-04 | `season4` dans l’URL | saison URL explicite | CONSERVER | `FP`, `SI` |
| S-05 | Saisons titre et URL identiques | saison canonique non conflictuelle | CONSERVER | `FP` |
| S-06 | Saisons titre et URL différentes | conflit, aucune saison inventée | CONSERVER | `FP` |
| S-07 | Saison sans sortie | progression `null` | CONSERVER | `FP` |
| R-01 | Chapitre explicite entier | chapitre retenu | CONSERVER | `FP`, `OR` |
| R-02 | Épisode explicite décimal avec virgule | épisode décimal | CONSERVER | `FP`, `OR` |
| R-03 | Chapitre URL décimal | chapitre décimal | CONSERVER | `FP`, `OR` |
| R-04 | Deux marqueurs de même qualité | dernière occurrence, pas le plus grand nombre | CONSERVER | `FP` |
| R-05 | Marqueur puis ID technique terminal | marqueur gagne, ID rejeté explicitement | CONSERVER | `FP` |
| R-06 | Année ou routing ID | aucune progression | CONSERVER | `FP`, `OR` |
| R-07 | Segment URL numérique sans identité | aucune progression | CONSERVER | `FP` |
| R-08 | Segment URL numérique avec identité | progression | CONSERVER | `FP` |
| R-09 | Nombre adjacent avec alias validé | progression selon type | CONSERVER | `FP` |
| R-10 | Nombre intrinsèque au titre | aucune progression | CONSERVER | `FP`, `OR` |
| R-11 | Nombre après identité numérique | seul le nombre supplémentaire progresse | CONSERVER | `FP`, `OR` |
| R-12 | Ordinal | reste identité | CONSERVER | `FP` |
| R-13 | Saison prouvée égale au segment URL | pas une sortie | CONSERVER | `FP` |
| R-14 | Conflit de saison + numéro local | conserver conflit et numéro local | CONSERVER | `FP`, `OR` |
| Q-01 | Enqueue identique après réveil | aucune tâche dupliquée | CONSERVER | `DQ` |
| Q-02 | Favori modifié | nouvelle empreinte et tâche distincte | CONSERVER | `DQ` |
| Q-03 | Course entre deux réveils | relire une fois et converger | CONSERVER | `DQ` |
| Q-04 | Suspension à chaque checkpoint | reprise depuis l’état durable | CONSERVER | `DQ`, `A87` |
| Q-05 | Claim expiré | rejeu avec même idempotency key | CONSERVER | `A87` |
| Q-06 | Retry-After ou rate reset | prochaine échéance durable exacte | CONSERVER | `PT`, `A87` |
| Q-07 | Hydratation après résolution | tâche ID exacte, aucun rematch | CONSERVER | `DQ` |
| Q-08 | Consentement retiré | tâches Review pending bloquées | CONSERVER | `DQ` |
| B-01 | Installation ou update | inventaire importé par tranches | CONSERVER | `BG` |
| B-02 | Création/modification/déplacement | convergence idempotente | CONSERVER | `BG` |
| B-03 | Suppression navigateur | aucune suppression de Work/progression | CORRIGER | `BG`, ADR-0025 |
| B-04 | Zéro favori | état vide réussi | CONSERVER | `A87` |
| B-05 | Échec de scan | ancienne projection conservée, erreur récupérable | CONSERVER | `A87` |
| O-01 | Corpus synthétique versionné | égalité profonde de l’artefact complet | CONSERVER | `OR` |
| O-02 | Corpus contenant des données privées | interdit | CORRIGER | frontière TobiRink |

## Découpage d’implémentation imposé

La réécriture ne doit pas recréer un fichier parser de plusieurs centaines de
lignes mêlant toutes les responsabilités. Les frontières minimales sont :

- qualification et disposition URL ;
- adaptateurs de preuve de source ;
- normalisation et segmentation de titre ;
- extraction de saison ;
- extraction et arbitrage de progression ;
- construction d’artefact ;
- matcher fournisseur pur ;
- routage fournisseur ;
- transport fournisseur ;
- orchestrateur et file durable ;
- projection vers `FavoriteSource`, `Review` et `Work`.

Tous dépendent de contrats possédés par TobiRink. Aucun module domaine ou
application n’importe WebExtension, Dexie, WXT, fetch, AniList ou
MangaUpdates directement.

## Défauts FavLib explicitement non repris

- plusieurs parseurs et helpers pouvant produire des décisions concurrentes ;
- fichier metadata monolithique mêlant parsing, HTTP, HTML, sécurité réseau,
  fournisseurs, agenda et mapping de statut ;
- background de plusieurs centaines de lignes portant toute l’orchestration ;
- base locale et file durable aux responsabilités mélangées ;
- bookmarks considérés comme autorité métier ;
- type manga inventé pour une route générique ;
- URL canonique dont le protocole ou le hostname sont réécrits sans preuve ;
- sélection par popularité, rang, ordre de réponse, richesse de métadonnées ou
  correspondance partielle ;
- attente longue en mémoire dans le service worker ;
- scan complet transformé sans tranche durable ;
- suppression cascade d’une œuvre à partir d’un événement bookmark ;
- contribution collective sans consentement local actif et revérifié.

## Critère de complétude avant codage

Une étape de réécriture peut commencer seulement si sa liste de tests référence
les identifiants de cette matrice, fixe les limites de taille et de temps
qu’elle touche, et précise la migration des artefacts. Une divergence observée
pendant l’implémentation doit modifier ce contrat et l’ADR dans une étape
documentaire approuvée ; elle ne peut pas être absorbée silencieusement dans le
code.
