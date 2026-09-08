# Audit des écarts FavLib → TobiRink pour les favoris

## Statut et portée

Ce document est le préalable obligatoire à toute nouvelle modification du
parser, de la résolution, de Review ou des projections privées TobiRink.

L'affirmation précédente selon laquelle la résolution était terminée était
incorrecte. Les tests présents prouvaient des contrats isolés mais ne couvraient
pas encore les quatre fondations décrites ci-dessous. L'objectif est un contrat
TobiRink stable, pas la fidélité complète à FavLib ni l'exploitation de
l'inventaire privé de l'utilisateur.

Cet audit ne modifie aucun code produit, aucune donnée IndexedDB, aucun favori,
aucune ressource Cloudflare et aucun déploiement. Il décrit les changements à
effectuer avant de reprendre l'implémentation.

Révisions inspectées :

- Doctrine FavLib historique inspectée : `3267de2`, `CLAUDE.md` et ADR 0087;
- FavLib `43325f7bc584` : observation secondaire du runtime récent, non normative;
- TobiRink : `302806b7eab4`, branche
  `chore/tobirink-live-resolution-deployment` ;
- le changement local préexistant FavLib `apps/web/next-env.d.ts` a été ignoré ;
- aucun code ni donnée FavLib ne doit être copié : les comportements sont une
  référence de réécriture propre.

## Autorités utilisées

Les sources FavLib ne sont pas toutes cohérentes entre elles. L'ordre
d'autorité retenu pour cet audit est :

1. contrat TobiRink approuvé et décisions utilisateur du 2026-09-08;
   favoris = présence/progression, IndexedDB = transactions privées, sync = IDs,
   D1 = clé normalisée/owner/IDs via Worker exclusivement;
2. doctrine historique `3267de2`, utilisée seulement pour identifier des
   comportements à accepter, corriger ou rejeter;
3. les tests déterministes des packages `metadata` et `apps/extension` ;
4. `packages/metadata/src/bookmark-parser.ts` ;
5. `packages/metadata/src/browser-resolver.ts` et le runtime IndexedDB/MV3 ;
6. les helpers historiques de `packages/metadata/src/index.ts` seulement
   lorsqu'ils ne contredisent pas les sources précédentes.

Les autorités TobiRink comparées sont les ADR 0034 et 0037, les deux documents
`favorite-parsing-resolution-spec.md` et
`favorite-resolution-rebuild-pipeline.md`, puis le code et ses tests.

## Verdict

La pipeline TobiRink auditée à cette date ne satisfaisait pas encore son propre
contrat de résolution.

Les deux défauts qui expliquent directement l'observation actuelle sont :

1. `importFavoriteSources` crée immédiatement une Review `pending` pour chaque
   favori HTTP(S), avant qu'une ambiguïté ait été démontrée ; la cloche devient
   donc une file de travail technique au lieu d'une file de décisions humaines.
2. Les adaptateurs TobiRink déclarent une recherche normale « incomplète » dès
   que le fournisseur indique d'autres pages. Le runner refuse alors toute
   décision, réessaie huit fois, puis bloque. AniList, MangaUpdates et Kitsu
   renvoient couramment plus de résultats que la limite locale : une grande
   partie de l'inventaire ne peut jamais être validée.

Le cas `https://www.youtube.com/watch?...` ajoute un troisième défaut : le
segment final `watch` n'est pas structurel dans TobiRink. Il devient un faux
titre stable et déclenche une résolution sans preuve d'œuvre.

## Doctrine historique et observations techniques FavLib

La doctrine `3267de2` fait autorité. Les détails de runtime ci-dessous sont
issus de l'inspection antérieure indiquée plus haut; ils ne peuvent remplacer
cette doctrine. La base privée réelle n'a pas encore été validée. Le
[plan canonique v3](favorite-resolution-correction-plan.md) précise les décisions,
les 30 écarts, la reconstruction sync et le collectif SQL.

### 1. Inventaire navigateur

- Chrome est l'autorité d'appartenance, de chemin de dossier et d'ordre.
- `webBookmark` accepte tous les favoris HTTP(S), conserve titre brut, URL
  canonique sans fragment, parent, position et dates, puis calcule une empreinte
  titre + URL.
- Les URL non HTTP(S) et les dossiers ne deviennent pas des favoris analysés.
- Le parcours est complet, déterministe et rejouable. Une interruption ne
  publie jamais un faux inventaire vide.
- Les créations, changements, déplacements et suppressions sont coalescés par
  identifiant de favori. Une mutation arrivée pendant un scan provoque un
  nouveau passage sérialisé.
- Une baisse de progression détectée demande confirmation ; elle n'écrase pas
  silencieusement la valeur précédente.
- Le digest d'inventaire utilise l'ordre des points de code, pas
  `localeCompare`, afin de rester identique à la projection persistée.
- `isMedia` recherche seulement des mots comme manga, anime, episode, chapter,
  volume, watch ou read. C'est un compteur/indice historique, pas une preuve
  d'identité et pas une barrière d'import.

Conséquence importante : le FavLib inspecté inventorie aussi les pages Web
ordinaires. Sa reconstruction récente parcourt tous les favoris HTTP(S). Le
besoin produit exprimé — ne pas remplir Review avec YouTube et tous les liens —
nécessite donc une frontière explicite supplémentaire ; il ne peut pas être
obtenu en recopiant `isMedia`.

### 2. Qualification et identité de source

La résolution FavLib ne prend pas le dernier segment arbitraire d'une URL comme
identité. Elle applique les règles suivantes :

- accepter uniquement HTTP(S) et préserver le brut ;
- reconnaître d'abord un identifiant fournisseur exact : AniList
  `/anime|manga/{id}` ou MangaUpdates `/series/{id}` ;
- sinon chercher une catégorie explicite `anime`, `manga`, `manhwa`, `manhua`,
  `webtoon`, `series`, `comic` ou `title`, puis prendre le segment suivant ;
- sinon accepter le segment précédant un chemin de sortie explicite
  `chapter|chapitre|chap|ch|episode|ep|volume|vol + nombre` ;
- refuser une identité absente, purement numérique ou trop courte ;
- séparer le slug stable du suffixe de sortie ;
- produire le type uniquement à partir du chemin explicite ; sinon conserver
  `UNKNOWN` ;
- conserver URL canonique, slug brut, slug stable, stratégie et preuves ;
- une route générique telle que `/watch` sans catégorie ni sortie ne prouve
  aucune œuvre ;
- un identifiant de routage opaque ou alphanumérique ne devient une identité
  que si un titre humain indépendant et unique le corrobore ;
- un préfixe numérique de routage n'est retiré que si le titre humain prouve le
  reste du slug ;
- une transformation de présentation ne doit jamais fabriquer une identité.

### 3. Parser de titre

Le parser canonique FavLib est `favorite-parser-v14`; son identité est en
version 14 et sa progression en version 10. Les invariants utiles sont :

- conserver exactement le titre et l'URL bruts dans l'artefact ;
- normaliser pour comparaison avec NFKD, suppression des marques, minuscules,
  espaces normalisés et séparation des caractères non alphanumériques ;
- conserver séparément forme normalisée, forme compacte et mots significatifs ;
- supprimer des comparaisons les stopwords déclarés sans modifier le brut ;
- nettoyer les préfixes `read`, `watch`, `lire`, `regarder` ;
- isoler les marqueurs `chapter`, `chapitre`, `ch`, `episode`, `épisode`, `ep`,
  `volume`, `vol` et leurs valeurs décimales ;
- isoler les variantes `nombre + vostfr|vf|vo|sub|dub|scan` ;
- retirer les suffixes marketing connus : lecture en ligne, gratuit, HD,
  nouvelles sorties et badges de piste/langue ;
- retirer un hostname final seulement s'il correspond au hostname observé ;
- dédupliquer les répétitions du même titre humain ;
- préserver les années et les ordinaux comme partie du titre ;
- préserver un nombre intrinsèque au titre lorsqu'aucune preuve indépendante
  ne permet de le traiter comme progression ;
- privilégier un slug URL stable prouvé, puis ajouter le titre humain nettoyé
  comme alias lorsqu'il est indépendant et compatible ;
- ne jamais tronquer un préfixe numérique ou textuel non corroboré ;
- conserver chaque transformation, preuve, candidat rejeté et motif.

### 4. Saison et progression

- Une saison exige un libellé explicite : `s`, `season`, `saison`, `temporada`,
  `stagione`, `staffel`, `seizoen`, `sesong`, `säsong`, `kausi`, `sezon`,
  `sezona`, `sezonas`, `сезон`, ou la forme ordinale anglaise/française.
- Un nombre final nu est une provenance, jamais une saison.
- Un conflit entre saison du titre et saison de l'URL est conservé ; aucune
  saison canonique n'est inventée.
- La progression accepte chapitre, épisode ou volume, y compris les décimales.
- L'ordre de qualité est : marqueur explicite du titre, chemin URL libellé,
  marqueur séparé, divergence de saison, puis nombre nu corroboré.
- À qualité égale, la dernière occurrence est retenue ; la valeur la plus
  grande n'est pas automatiquement retenue.
- Un segment URL terminal numérique n'est une progression qu'après preuve
  d'identité de source et selon le type média.
- Un nombre final dans le titre n'est une progression qu'après alignement avec
  un alias validé.
- Une saison, une année, un identifiant de routage, un nombre négatif ou non
  fini ne deviennent pas une progression.
- Tous les candidats restent traçables avec position, brut, provenance,
  qualité et raison de rejet.
- La progression n'est projetée dans la bibliothèque qu'après résolution
  fournisseur prouvée du favori exact.

### 5. Langue locale

FavLib possède une pipeline de preuves de langue distincte de l'identité :

- langue du chemin URL ;
- langue du manifeste ;
- attribut HTML `lang` ;
- en-tête `Content-Language` ;
- `og:locale` ;
- `hreflang` ;
- statistique locale uniquement avec au moins 80 caractères et une confiance
  d'au moins 0,85.

Des preuves fortes incompatibles rendent le résultat ambigu. Une statistique
ne doit pas écraser une preuve forte. La langue qualifie une édition ou une
source ; elle ne choisit jamais une œuvre et ne doit pas devenir un signal de
popularité déguisé.

### 6. Résolution fournisseur

L'ordre FavLib est déterministe :

1. identifiant fournisseur exact dans l'URL ;
2. artefact du parser partagé ;
3. résolution/hydratation locale encore valide ;
4. titres principal et alternatifs ;
5. index collectif par clé normalisée, s'il est activé ;
6. recherche publique locale ;
7. hydratation exacte de l'identifiant décidé.

Pour la recherche :

- AniList et MangaUpdates sont les fournisseurs canoniques inspectés ;
- `ANIME` interroge AniList, les types manga interrogent MangaUpdates et
  `UNKNOWN` interroge les deux ;
- au plus trois alias et dix résultats par fournisseur sont utilisés ;
- les alias sont interrogés séquentiellement et les identifiants dédupliqués ;
- une fenêtre bornée de résultats est une entrée valide du matcher : FavLib ne
  demande pas que l'API affirme avoir retourné tout son catalogue ;
- l'ordre, la popularité, le rang, la date, l'image et le premier résultat ne
  sont jamais des preuves ;
- les niveaux sont, dans l'ordre : ID source, URL source, titre ordonné exact,
  saison explicite, mots significatifs réordonnés, distance d'édition bornée ;
- zéro correspondance donne `NO_MATCH` ; plusieurs identités distinctes au
  meilleur niveau donnent `AMBIGUOUS` ; une seule donne `MATCH` ;
- pour un type `UNKNOWN`, même des résultats exacts des deux catalogues exigent
  une décision explicite plutôt qu'un choix automatique de catalogue ;
- une saison fournisseur explicite ne correspond qu'à une saison source
  explicitement compatible ;
- l'hydratation se fait uniquement par ID exact et ne répète jamais le matching.

Kitsu est l'extension produit désormais approuvée : fallback après NO_MATCH
complet, jamais arbitre d'une panne ou ambiguïté principale. MangaDex garde
son rôle exact/sorties. Ces choix appartiennent au contrat TobiRink.

### 7. Transport, cadence et cache

- Les opérations fournisseur sont fixes et exécutées depuis le worker MV3.
- Les réponses sont bornées à 512 Kio, les requêtes à 8 secondes et les schémas
  invalides échouent explicitement.
- Les erreurs réseau, timeout, 429, 403, 5xx et payload invalide restent
  distinctes.
- `Retry-After`, y compris sa forme date HTTP, et `X-RateLimit-Reset` sont
  respectés ; des délais conservateurs existent lorsqu'ils sont absents.
- Une panne fournisseur ne doit pas être mise en cache comme un résultat
  négatif.
- Les recherches positives et négatives ont des TTL distincts.
- Les lanes AniList et MangaUpdates sont partagées par résolution et
  hydratation, sérialisées et persistées. AniList reste sous 30 requêtes/minute
  en mode dégradé.
- Une reprise après interruption conserve l'index d'alias et n'effectue pas à
  nouveau les appels déjà attestés.
- Les payloads bruts fournisseur sont conservés comme provenance locale bornée.

### 8. Durabilité MV3

- IndexedDB est la projection transactionnelle locale ; `storage.local` ne
  contient que bootstrap, préférences, migration et diagnostics compacts.
- Un scan doit être `STABLE` et sa migration `COMMITTED` avant de lancer les
  fournisseurs ou d'annoncer un inventaire vide.
- Le runner durable suit `READY → CLAIMED → EFFECT_RECORDED → COMMITTED`.
- Chaque tâche possède une clé d'idempotence stable ; deux réveils concurrents
  ne produisent qu'un effet.
- Une lease expirée est récupérable. Le résultat utile est persisté avant le
  commit de tâche.
- Les tâches ajoutées par un effet peuvent être traitées dans la même tranche,
  mais le nombre de tâches et la durée réelle restent bornés.
- Une résolution réussie programme prioritairement son hydratation exacte avant
  la résolution suivante.
- Les indisponibilités fournisseur temporaires restent réessayables au-delà du
  plafond générique ; seules les erreurs terminales deviennent `BLOCKED`.
- Le pipeline de reconstruction est checkpointé : rescan, projection,
  hydratation, aliases, parsing/matching, agenda, fin.
- Une erreur de quota arrive avant le snapshot atomique et ne publie pas une
  projection partielle comme complète.

### 9. Review et décision humaine

- FavLib persiste une résolution `REVIEW` uniquement après le résultat du
  resolver (`AMBIGUOUS` ou `NO_MATCH`), pas comme preuve que le favori est une
  œuvre.
- La file visible est dérivée des enregistrements de résolution `REVIEW`, triée
  et paginée de façon stable.
- Le détail conserve le favori brut et au plus dix candidats.
- Une décision doit relire une révision et échoue en cas de conflit.
- Un choix automatique doit être un candidat présent. Une saisie manuelle doit
  être un ID fournisseur exact ou une URL HTTPS fournisseur valide.
- La décision écrit `RESOLVED`, puis programme une hydratation par ID exact.
- La contribution collective est indépendante, désactivable et émise seulement
  après choix explicite et consentement.
- Une contribution collective ne contient ni titre brut ni URL brute ; elle
  transporte une clé normalisée et un pseudonyme local.
- Le retrait du consentement bloque les tâches de contribution encore actives.

## Matrice exacte des écarts TobiRink

| ID | Sévérité | État TobiRink observé | Comportement cible | Changement requis |
| --- | --- | --- | --- | --- |
| G-01 | critique | `normalizeBookmarks` qualifie tout HTTP(S) comme `eligible` | inventaire HTTP(S) distinct de l'éligibilité à la résolution | ajouter une classification persistée `candidate`, `unsupported`, `needs-evidence`; ne rien supprimer |
| G-02 | critique | `importFavoriteSources` crée une Review `pending` avant décision | Review contient seulement une décision humaine réelle | séparer `FavoriteSource`, état d'analyse et Review ; créer Review après `AMBIGUOUS`/`NO_MATCH` selon politique |
| G-03 | critique | `/watch` n'est pas structurel ; YouTube devient l'identité « watch » | route utilitaire sans catégorie/sortie = aucune identité | fermer le vocabulaire structurel et exiger catégorie, sortie ou adaptateur exact |
| G-04 | critique | le dernier segment générique suffit souvent | aucune identité depuis un segment arbitraire | remplacer `genericEvidence` par la frontière catégorie/sortie/corroboration de FavLib |
| G-05 | critique | un envelope paginé est déclaré incomplet | page valide distincte d'ensemble pertinent complet | séparer validité, curseur, hasMore et exhaustivité pertinente; persister la pagination |
| G-06 | critique | le runner exige `complete && !truncated` | unicité prouvée sur ensemble pertinent; ambiguïté si plusieurs identités prouvées | retirer le retry automatique déclenché uniquement par `hasNextPage`/`total_hits` |
| G-07 | critique | après huit essais normaux, tâche bloquée | pagination normale n'est pas une panne ; panne temporaire reste réessayable | distinguer `HAS_MORE`, panne transitoire, payload invalide et erreur terminale |
| G-08 | haute | la cloche lit toutes les Reviews `pending` | cloche = ambiguïtés/no-match actionnables | requêter un état Review explicite, avec candidat/motif et analyse terminée |
| G-09 | haute | l'état `pending` mélange import, analyse, ambiguïté et erreur | états distincts et explicables | introduire une machine d'état analyse/résolution séparée de Review |
| G-10 | haute | parser `favorite-parser-v2.1` ne prouve pas la parité v14 | tous les comportements canoniques sont portés ou explicitement rejetés | compléter segmentation, identité, provenance et corpus différentiel |
| G-11 | haute | règles de source trop courtes et liste structurelle incomplète | catégories, sorties, utilitaires et routage bornés | centraliser un seul extracteur, testé avec URLs réelles anonymisées |
| G-12 | haute | l'alias du titre peut être construit depuis une fausse identité | un alias n'existe qu'après corroboration | faire dépendre aliases et progression d'une preuve d'identité explicite |
| G-13 | haute | la langue locale existe mais n'est pas composée dans le runtime | preuves de langue persistées, sans agir sur l'identité | raccorder la collecte de page au port local, avec consentement/permissions explicites |
| G-14 | haute | les recherches TobiRink n'utilisent que le premier alias | jusqu'à trois alias, séquentiels, dédupliqués et reprenables | ajouter curseur d'alias dans la tâche et fusion stable des candidats |
| G-15 | haute | le modèle de tâche TobiRink n'atteste pas toutes les étapes d'effet FavLib | reprise sans double projection ni double appel | auditer/aligner claim, effet enregistré, curseur, projection et commit |
| G-16 | haute | le fallback Kitsu peut masquer une panne ou changer un résultat FavLib | extension fournisseur décidée et testée séparément | Kitsu uniquement après NO_MATCH complet, sans arbitrage des ambiguïtés |
| G-17 | haute | l'AniList search TobiRink force `type: ANIME` | un lien AniList manga exact doit rester hydratable ; les routes suivent le type prouvé | séparer recherche anime, éventuel manga et hydratation exacte par ID/type |
| G-18 | haute | pas d'index local de décisions/hydratations antérieures dans l'ordre observé | réutiliser les preuves locales valides avant le réseau | ajouter lookup par empreinte/clé normalisée avec version et invalidation |
| G-19 | moyenne | la provenance fournisseur est réduite à un digest/candidats projetés | conserver le brut borné et le schéma/version ayant produit la décision | enrichir le reçu local sans exposer le brut au site |
| G-20 | moyenne | la progression est stockable avant preuve complète dans certains chemins | progression projetée seulement avec l'œuvre résolue du favori exact | ajouter un invariant au commit et un test de favori modifié |
| G-21 | moyenne | `Review no-match` et ambiguïté ne sont pas clairement séparées dans la cloche | motif, candidats et actions correspondent à l'état | fermer le vocabulaire et adapter la projection WebBridge/UI |
| G-22 | moyenne | les décisions manuelles TobiRink ne sont pas démontrées équivalentes aux gardes FavLib | révision fraîche, candidat existant ou ID/URL fournisseur exact | compléter validation et tests de conflit/domaine/type |
| G-23 | moyenne | les limites de scan et de slice existent mais la convergence réelle n'est pas prouvée | inventaire complet et reprise sur grande bibliothèque | tester plusieurs réveils, mutations concurrentes, quota et suspension MV3 |
| G-24 | moyenne | les docs/ADR actuels déclarent le faux contrat d'ensemble fournisseur complet | documentation conforme au protocole paginé avec preuve d'exhaustivité pertinente | corriger ADR 0037, spécification, pipeline et diagramme après décision |
| G-25 | moyenne | l'oracle actuel réencode les attentes TobiRink | oracle indépendant dérivé des cas FavLib canoniques | versionner entrées anonymisées + sorties attendues exhaustives, sans importer FavLib |
| G-26 | moyenne | les E2E synthétiques ont été présentés comme preuve live | chaque niveau de preuve est nommé honnêtement | séparer unitaires, différentiel, intégration fournisseur contrôlée et observation opérateur |
| G-27 | moyenne | les données déjà importées portent parser v2.1 et Reviews artificielles | nouvelle version doit retraiter sans perdre décisions ni favoris | migration non destructive et reconstruction versionnée |
| G-28 | décision | TobiRink rend IndexedDB autoritaire, FavLib rend Chrome autoritaire | favoris autorité présence/progression; sync IDs reconstruits | restaurer doctrine 3267de2 sans suppression de données |
| G-29 | décision | le besoin utilisateur exclut les liens ordinaires de Review, contrairement au dernier FavLib inspecté | inventaire exhaustif mais Review uniquement média/actionnable | formaliser une classe `unsupported` réversible et visible seulement en diagnostic |
| G-30 | décision | FavLib possède un index collectif optionnel ; TobiRink ne reproduit pas cet ordre | D1 minimal owner-scoped par Worker avec confirmations distinctes | décision séparée ; aucune dépendance Cloudflare implicite |

## Analyse spécifique du cas YouTube

Pour `https://www.youtube.com/watch?v=...` :

1. l'adaptateur navigateur TobiRink accepte l'URL parce qu'elle est HTTP(S) ;
2. aucun adaptateur source exact YouTube n'existe ;
3. `genericEvidence` choisit le dernier segment, `watch` ;
4. `watch` n'appartient pas à `structuralSegments` ;
5. l'artefact devient `parsed` avec le faux titre `watch` ;
6. une Review `pending` existe déjà avant cette analyse ;
7. AniList et MangaUpdates sont interrogés, puis Kitsu peut l'être ;
8. les réponses paginées sont considérées incomplètes ;
9. le runner réessaie, bloque éventuellement, et la Review reste visible.

La correction ne consiste pas à ajouter seulement `youtube.com` à une liste
noire. Elle doit rendre impossible toute identité générique sans preuve. Un
adaptateur exact peut ensuite être ajouté pour une source média réellement
supportée, sans ouvrir toutes les routes du domaine.

## Architecture cible à implémenter

La future pipeline doit séparer les états suivants :

```text
Chrome HTTP(S)
  → inventaire brut durable
  → qualification locale de source
      → unsupported / needs-evidence : diagnostic, aucune Review
      → candidate : artefact parser versionné
          → preuve fournisseur exacte : hydratation par ID
          → titre prouvé : recherche bornée
              → MATCH : Work + progression + hydratation
              → AMBIGUOUS : Review avec candidats
              → NO_MATCH complet : Review NOT_FOUND actionnable
              → TEMPORARY_FAILURE : retry, aucune Review artificielle
```

Les frontières de modules à viser sont :

- inventaire navigateur : brut, dossiers, ordre, présence et empreinte ;
- qualification : HTTP(S) n'est pas synonyme de média ;
- source adapters : origine exacte et routes explicitement reconnues ;
- parser pur : brut → artefact, sans stockage ni réseau ;
- resolver pur : artefact + fenêtre de candidats valide → décision ;
- provider ports : recherche bornée, pagination descriptive, hydratation exacte ;
- scheduler MV3 : cadence, reprises et idempotence ;
- commit : Source/Artifact/Decision/Work atomiques ;
- Review : uniquement décisions humaines actionnables ;
- projections : bibliothèque et cloche lisent les décisions persistées, jamais
  l'état transitoire du runner.

## Plan de changements avant tout nouveau déploiement

### Phase A — Corriger les contrats et l'oracle

Fichiers probables :

- `packages/domain/src/favorites/contracts.ts` ;
- `packages/domain/src/favorites/vocabularies.ts` ;
- `packages/application/src/favorites/provider-matcher.ts` ;
- tests associés ;
- ADR 0037, spécification, pipeline et
  `docs/architecture/src/favorite-resolution.dataflow.json`.

Travail : distinguer validité de page et exhaustivité de l'ensemble pertinent, fermer les diagnostics, définir les états de qualification et rendre
l'oracle indépendant. Aucun fournisseur ni UI ne change dans cette phase.

Acceptation : `hasMore=true` avance un curseur durable; un MATCH exige
l'unicité prouvée et une ambiguïté exige plusieurs identités prouvées. Une
réponse coupée, invalide ou dépassant les bornes reste RETRYABLE; le
premier résultat et le rang n'influencent jamais la décision.

### Phase B — Réécrire la qualification et le parser

Fichiers probables :

- `packages/adapters-browser/src/bookmarks/normalize-bookmarks.ts` ;
- `packages/application/src/favorites/source-evidence.ts` ;
- `favorite-parser.ts`, `title-segmentation.ts`, `season-extraction.ts`,
  `progression-extraction.ts`, `title-normalization.ts` ;
- source adapters et tests.

Travail : séparer inventaire et éligibilité, fermer les routes structurelles,
porter toutes les règles v14 listées ici, conserver les preuves et ajouter les
cas YouTube/génériques. Le parser reste local, pur et sans liste de vrais titres.

Acceptation : `/watch`, `/search`, `/login`, racines et routes numériques ne
produisent pas d'identité ; catégories/sorties prouvées, slugs opaques
corroborés, saisons et progressions reproduisent le corpus canonique.

### Phase C — Séparer analyse, résolution et Review

Fichiers probables :

- `packages/application/src/use-cases/import-favorite-sources.ts` ;
- `favorite-resolution-runner.ts` et commit associé ;
- ports et adaptateur IndexedDB ;
- `read-review-queue.ts`, candidats et décisions ;
- migrations du schéma privé.

Travail : ne plus créer Review à l'import, persister un état d'analyse,
matérialiser Review uniquement après décision du resolver, préserver les
décisions explicites et rendre les pannes invisibles dans la cloche.

Acceptation : une bibliothèque nouvellement importée affiche une progression
d'analyse, pas tous les liens dans Review ; seuls ambiguïtés/no-match décidés y
apparaissent ; une panne fournisseur n'invente aucune décision.

### Phase D — Aligner les fournisseurs et le scheduler MV3

Fichiers probables :

- `packages/application/src/favorites/provider-ports.ts` ;
- adaptateurs AniList, MangaUpdates et éventuellement Kitsu ;
- `provider-http.ts` ;
- runtime et alarmes de l'extension ;
- tests de suspension, cadence et reprise.

Travail : interroger plusieurs alias séquentiellement, persister le curseur,
respecter les lanes, différencier pagination et erreur, réutiliser les preuves
locales et hydrater seulement par ID exact.

Acceptation : la pipeline converge sur plusieurs réveils ; 429/403/timeout ne
deviennent pas no-match ; un effet n'est pas appliqué deux fois ; la décision
reste stable lorsque les résultats sont réordonnés.

### Phase E — Migrer sans perte les données locales existantes

Travail :

- introduire une version de pipeline supérieure à v2.1 ;
- conserver l'inventaire, les chemins, l'ordre et les favoris bruts ;
- conserver une décision utilisateur explicite si source, empreinte, type et
  fournisseur restent compatibles ;
- invalider et retraiter les décisions automatiques issues du faux contrat ;
- reclasser les Reviews créées par défaut en état d'analyse/unsupported ;
- annuler logiquement les anciennes tâches par version/idempotency key sans
  supprimer les enregistrements utilisateur ;
- reconstruire Work et progression uniquement depuis des décisions valides ;
- publier un reçu avec totaux `candidate`, `resolved`, `review`, `unsupported`,
  `retrying` et `failed`.

Acceptation : aucune suppression de favori, dossier, progression confirmée ou
décision humaine ; migration relançable ; interruption récupérable ; totaux
recalculés depuis les lignes durables.

### Phase F — Corriger les projections et l'UX

Travail :

- la cloche ne lit que les Reviews actionnables ;
- bibliothèque/accueil distinguent analyse, partiel, vide réel et indisponible ;
- une source non supportée n'est ni une œuvre ni une Review ;
- les diagnostics techniques ne sont pas présentés comme des choix utilisateur ;
- WebBridge transporte des états bornés et validés, sans brut fournisseur.

Acceptation : avec une extension fraîche et un inventaire contenant YouTube,
pages ordinaires et vrais lecteurs, seuls les vrais cas ambigus arrivent dans
Review ; aucun contenu privé n'apparaît sans connexion.

### Phase G — Validation avant publication

La validation devra fournir quatre niveaux de preuve séparés :

1. tests unitaires exhaustifs du parser, source resolver, progression, saison,
   langue et matcher ;
2. corpus différentiel propre, versionné et anonymisé reproduisant les formes
   réelles observées, sans importer de données FavLib ;
3. intégration locale déterministe avec payloads fournisseur capturés et
   anonymisés, réordonnés, paginés, invalides et rate-limités ;
4. observation opérateur sur un profil de test Chrome local, explicitement
   décrite comme observation et jamais comme oracle automatisé.

Cas obligatoires :

- YouTube `/watch`, `/shorts/{id}`, recherche et homepage : unsupported ;
- pages documentation, login, search, tags, genres, catégories racines ;
- routes manga/anime explicites et routes de sortie ;
- slug opaque corroboré/non corroboré ;
- préfixe numérique, année, ordinal, nombre intrinsèque ;
- chapitres/épisodes/volumes décimaux et occurrences multiples ;
- saisons multilingues, nombre nu et conflit titre/URL ;
- titre accentué, ponctuation, répétition, hostname et marque lecteur ;
- ID AniList anime/manga et ID MangaUpdates exacts ;
- UNKNOWN avec résultats dans les deux catalogues ;
- résultat unique, égalité, aucun résultat et résultats réordonnés ;
- `hasMore=true` valide, payload tronqué en octets et schéma invalide ;
- 429 avec secondes/date, reset AniList, 403, 5xx, timeout et offline ;
- crash à chaque frontière de tâche, lease expirée et deux réveils concurrents ;
- grande bibliothèque sur plusieurs scans/réveils et mutation pendant scan ;
- migration depuis les Reviews artificielles actuelles ;
- conflit de révision, candidat inconnu et URL manuelle non fournisseur ;
- vérification que la cloche ne contient jamais les tâches en cours, retries,
  erreurs fournisseur ou sources unsupported.

Les tests synthétiques restent nécessaires et reproductibles. La préparation
de production ajoute les validations navigateur, Worker/D1, sécurité, quotas,
reprise et packaging. Aucune donnée personnelle ne doit être ajoutée au dépôt.

## Traçabilité des règles auditées

| Domaine | Sources FavLib inspectées | Preuves de test inspectées | Équivalents TobiRink inspectés |
| --- | --- | --- | --- |
| doctrine et autorité | `CLAUDE.md`, `docs/adr/0087-architecture-locale-favoris-resolution-agenda.md` | règles de validation déclarées dans ces deux fichiers | ADR 0034, ADR 0037 |
| inventaire HTTP(S) | `apps/extension/src/core.ts`, `sync.ts`, `initial-scan.ts` | `core.test.ts`, `wave3.test.ts`, `initial-scan.test.ts` | `packages/adapters-browser/src/bookmarks/normalize-bookmarks.ts`, runtime d'inventaire extension |
| reconstruction | `apps/extension/src/reconstruction.ts`, `resolution-rebuild.ts` | `resolution-rebuild.test.ts`, scénarios de scan interrompu | runtime de reconstruction et runner TobiRink |
| parser et identité | `packages/metadata/src/bookmark-parser.ts` | `bookmark-parser.test.ts` | `favorite-parser.ts`, `source-evidence.ts`, `title-segmentation.ts` et leurs tests |
| source resolver | `packages/metadata/src/browser-resolver.ts` | `browser-resolver.test.ts` | source adapters TobiRink et `source-evidence.ts` |
| matcher | `packages/metadata/src/provider-title-v17.ts`, `browser-resolver.ts` | stabilité à l'ordre, égalité, saison et distance dans `browser-resolver.test.ts` et `browser-provider-client.test.ts` | `provider-matcher.ts`, contrats domaine et oracle TobiRink |
| transport public | `packages/metadata/src/browser-provider-transport.ts`, `apps/extension/src/browser-provider-client.ts` | `browser-provider-client.test.ts` | adaptateurs AniList/MangaUpdates/Kitsu et `provider-http.ts` |
| cadence et tâches | `provider-lane.ts`, `task-runner.ts`, `browser-resolution-queue.ts` | `provider-lane.test.ts`, `task-runner.test.ts`, `browser-resolution-queue.test.ts` | `favorite-resolution-runner.ts`, outbox et tests associés |
| hydratation | `browser-provider-client.ts`, `public-hydration-cache.ts` | exact-ID, payload brut, TTL et négatif dans `browser-provider-client.test.ts` et `browser-resolution-queue.test.ts` | ports d'hydratation et adaptateurs fournisseur TobiRink |
| Review | `local-review.ts`, `browser-resolution-queue.ts` | `local-review.test.ts`, cas ambiguous/no-match de la queue | `import-favorite-sources.ts`, `read-review-queue.ts`, `read-review-candidates.ts` |
| bibliothèque | `local-library.ts` | contrats locaux de projection | use cases Library et projection WebBridge TobiRink |
| langue | modules langue sous `packages/metadata/src/` | cas L-01 à L-05 recensés par la spécification | `local-language-evidence.ts` et son test, non composé au runtime |
| documentation antérieure | ADR 0087 | invariants explicités | `favorite-parsing-resolution-spec.md`, `favorite-resolution-rebuild-pipeline.md`, `favorite-resolution.dataflow.json` |

Cette table est une carte de provenance, pas une affirmation que tout le code
FavLib est canonique. En particulier, les helpers historiques de
`packages/metadata/src/index.ts`, le compteur lexical `isMedia` et la
reconstruction de tous les HTTP(S) sont signalés lorsque leur comportement ne
répond pas au besoin actuel.

## Décisions verrouillées avant le codage

Favoris autorité présence/progression; IndexedDB transactionnel; sync IDs
seuls; Worker unique détenteur D1; collectif minimal owner-scoped. NOT_FOUND
reste actionnable; no-match est humain. Kitsu est un fallback après NO_MATCH
complet seulement. Aucun lien ordinaire ne pollue la cloche. Ces décisions
sont approuvées; le plan v3 et ses huit étapes Progress remplacent l'ordre des
anciennes phases A–G conservées ci-dessus comme inventaire de travail.

## Critère de reproduction terminée

La reproduction ne pourra être déclarée terminée que lorsque :

- chaque règle conservée ci-dessus possède un test ciblé ;
- chaque divergence volontaire possède une décision versionnée ;
- le corpus différentiel complet passe sur l'artefact, pas seulement sur un
  titre final ;
- les recherches paginées normales convergent sans blocage ;
- les liens ordinaires, dont YouTube, ne polluent pas Review ;
- une grande reconstruction MV3 reprend après interruption ;
- la migration préserve les données et décisions humaines ;
- l'UI expose fidèlement les états persistés ;
- les preuves locales, les builds et l'observation opérateur sont rapportés
  séparément ;
- aucun déploiement n'a lieu avant la revue et l'approbation de ces changements.

À la date de cet audit, ces conditions n'étaient pas remplies. Progress porte
les preuves de leur correction sans déclarer FavLib comme dépendance ou oracle.
