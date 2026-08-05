# Résolution d’entités fournisseurs

## Objet

FavLib rapproche une identité locale créée depuis un favori personnel d’une œuvre fournie par AniList ou MangaUpdates. Ce rapprochement est une résolution d’entité, pas une simple recherche de titre : une réponse fournisseur reste une observation externe jusqu’à ce qu’une règle de décision l’autorise à devenir une identité canonique.

Cette règle s’applique à chaque favori, même lorsque plusieurs favoris finissent par partager la même œuvre canonique. Le titre du navigateur, l’URL favorite et la progression restent personnels ; les titres et métadonnées fournisseur restent attribués à leur fournisseur.

## Règles invariantes

1. Les alias de recherche provenant du favori sont limités à `source` et `personal`, y compris le titre porté par l’URL. Un titre fournisseur ne devient jamais automatiquement un alias source.
2. Une donnée observée pendant un test, un audit ou une recherche n’est pas une donnée du catalogue tant qu’elle n’est pas persistée avec sa provenance.
3. Une hypothèse de correspondance doit être exprimée par un code et un journal traçable.
4. Une correction ne peut pas viser un titre particulier. Les variantes, seuils et plafonds sont génériques et bornés.
5. Un candidat n’est pas une sélection. Il ne devient une identité liée qu’à la suite d’une validation automatique conforme ou d’une décision utilisateur.
6. Une image ne participe jamais à la résolution d’identité.

## Données et provenance

```text
favori Chrome
  ├─ URL + slug → media_title(kind=source)
  ├─ titre personnel → media_title(kind=personal)
  └─ observation fournisseur
       ├─ candidate_snapshot / favorite_review_candidate
       └─ après décision seulement : media_external_id + media_metadata ACTIVE
```

Les données `official`, `supplier` et `synonym` décrivent le catalogue après enrichissement. Elles peuvent être affichées ou comparées, mais elles ne réinjectent pas silencieusement de nouvelles entrées dans la requête du favori. La distinction est importante pour éviter qu’un résultat antérieur fabrique artificiellement une nouvelle preuve de résolution.

## Normalisation commune

La normalisation est utilisée uniquement pour comparer ou générer une requête : elle ne remplace jamais le texte conservé.

```text
compactTitleKey("Isekai Oji-san") → "isekaiojisan"
compactTitleKey("Isekai Ojisan")  → "isekaiojisan"
```

La clé compacte ignore les accents, la casse, la ponctuation, les tirets et les espaces. Ainsi `Isekai Ojisan` et `Isekai Oji-san` peuvent correspondre. Le titre fournisseur conserve cependant son trait d’union dans la review et dans le catalogue.

Les variantes génériques couvrent notamment la ponctuation, les tirets et espaces, les accents et la décomposition Unicode, les suffixes de publication ou d’épisode détectables, ainsi que des formes tokenisées bornées et quelques variantes singulier/pluriel génériques. Aucune variante anglaise externe ou titre fournisseur découvert en cours de recherche n’est ajouté aux alias du favori.

## Pipeline commun cible

```text
ID fournisseur connu ?
  ├─ oui → fiche directe → contrôle du type → identité connue ou review
  └─ non
       → aliases source/personal
       → variantes bornées
       → recherches paginées et limitées
       → agrégation + déduplication par ID fournisseur
       → comparaison de tous les titres retournés
       → décision déterministe ou review
       → fiche riche uniquement après décision
```

| Situation | Résultat | Sélection automatique |
|---|---|---:|
| ID externe déjà connu et type correct | résolution connue | oui |
| une seule correspondance normalisée/compacte | résolution exacte | oui |
| plusieurs correspondances exactes | review | non |
| candidats retournés mais aucun exact | review `LOW_CONFIDENCE` | non |
| candidats d’un autre type uniquement | review `TYPE_MISMATCH` | non |
| aucun candidat fournisseur | review vide `NO_RESULT` | non |
| erreur API, timeout ou rate limit non récupéré | erreur conservée | non |

La comparaison exacte est une preuve suffisante dans le cadre de la règle actuelle, à condition qu’elle soit unique et compatible avec le type. Une ressemblance partielle ne valide pas automatiquement une œuvre.

## Worker AniList

### Flux actuel

1. Un ID AniList local connu est récupéré directement et son type est vérifié.
2. Les alias sont lus seulement depuis `source` et `personal`.
3. Les variantes sont générées puis plafonnées à 32 requêtes logiques.
4. Les pages 1 et 2 sont recherchées avec 10 résultats par page.
5. Les candidats sont regroupés et dédupliqués par ID.
6. Les champs `userPreferred`, `english`, `romaji`, `native` et `synonyms` sont comparés à la clé normalisée et compacte.
7. Une correspondance unique exacte est validée.
8. Un résultat ambigu ou seulement ressemblant est conservé en review.
9. Une absence de résultat crée une review `NO_RESULT`.
10. La fiche riche est chargée seulement après la décision automatique, ou pour détailler les candidats d’une review.

Le plafond de 32 variantes est un maximum, pas une obligation. La boucle s’arrête lorsqu’une correspondance exacte unique est établie. Lorsqu’aucune correspondance n’est trouvée, elle peut parcourir le plafond afin de fournir une review utile.

### Codes de résolution

Les succès utilisent notamment `KNOWN_EXTERNAL_ID`, `NORMALIZED_EXACT` ou `COMPACT_EXACT`. Les reviews utilisent `TYPE_MISMATCH`, `LOW_CONFIDENCE`, `AMBIGUOUS` ou `NO_RESULT`. Les erreurs API conservent le code normalisé de l’erreur fournisseur.

Les appels AniList sont cadencés par la lane partagée. Un `429` est retenté après `Retry-After` ou `X-RateLimit-Reset`. Les échecs persistants restent soumis au plafond de tentatives du job et à l’état d’enrichissement.

## Worker MangaUpdates

### Flux actuel

Le worker lecture dispose déjà d’un score déterministe `resolveMangaUpdatesSeries` qui filtre le type, rejette les fiches mortes et classe les résultats. Il :

1. lit actuellement `source`, `official`, `supplier` et `synonym` ;
2. génère les variantes normalisées ;
3. recherche les variantes séquentiellement sans pagination explicite ;
4. peut s’arrêter sur un titre normalisé exact ;
5. sinon charge les fiches de tous les résultats distincts ;
6. applique un score avec correspondance de titres, tokens et signaux de fiche ;
7. envoie les ambiguïtés parenthésées en review ;
8. valide le meilleur candidat au-dessus du seuil ;
9. crée `NO_RESULT` si aucun candidat n’est résolu.

### Écart connu

Ce worker est plus permissif et plus coûteux que le worker AniList. Il doit être réaligné sur le pipeline commun avant de pouvoir être déclaré conforme : exclure les titres fournisseur des alias d’entrée, agréger tous les résultats avant de sélectionner, borner explicitement les variantes et la pagination, ne charger les fiches riches que pour un ensemble réduit de candidats, distinguer `EXACT`, `LOW_CONFIDENCE`, `TYPE_MISMATCH` et `NO_RESULT`, et ne jamais laisser l’ordre des résultats fournisseur décider seul.

Le score peut être conservé comme signal de classement et d’explication, mais un score seul ne doit pas sélectionner une œuvre lorsque plusieurs candidats restent proches ou lorsqu’il n’existe pas de correspondance exacte suffisante.

## Comparaison architecturale

| Dimension | AniList actuel | MangaUpdates actuel | Cible commune |
|---|---|---|---|
| Alias d’entrée | `source`/`personal` | inclut fournisseur | `source`/`personal` |
| Recherche | bornée et paginée | séquentielle, pagination implicite | bornée et paginée |
| Agrégation | globale et dédupliquée | partielle puis détaillée | globale |
| Décision | exact unique | meilleur score | exact unique ou score très encadré |
| Fiche riche | après décision | immédiate ou N+1 | après décision |
| Ambiguïté | review | parenthèses principalement | review explicite |
| Provenance | codes + snapshot | snapshot fournisseur | codes + snapshot |

L’écart n’est donc pas une différence légitime de difficulté métier : c’est une asymétrie de sûreté et de budget réseau. La lecture peut avoir des titres plus instables, mais cela justifie davantage de candidats documentés, pas une sélection silencieuse du premier résultat.

## Reviews et réparation

Une review `PENDING` conserve le favori original, son URL, le fournisseur, la cause et les candidats détaillés. Un candidat ne crée pas de média canonique avant le choix utilisateur.

La migration `0020_repair_favorite_reviews.sql` reconstruit les candidats depuis `media_enrichment_state.candidate_snapshot` lorsque le lien est encore reconstructible. Elle ne modifie ni `status`, ni `selected_candidate_id`, ni `decision`, ni les liens de favoris. Une review sans snapshot reçoit une cause `NO_RESULT` sans sélection automatique.

## Observabilité minimale

Chaque tentative doit permettre de répondre à ces questions sans lire un secret ou un favori complet dans les logs : fournisseur, version de connecteur et média local ; nombre d’alias, variantes et candidats distincts ; code de décision ; erreur réseau ou de type ; nombre de tentatives et prochain délai.

Les payloads complets restent en base dans les emplacements prévus pour l’audit, pas dans les logs opérationnels.

## Critères de conformité

Un worker est conforme lorsque aucune donnée fournisseur ne devient un alias source sans action explicite, que les recherches sont bornées, paginées et idempotentes, que l’ordre des résultats ne suffit jamais à sélectionner, que le type est contrôlé avant persistance, que les candidats sont conservés lorsqu’ils peuvent aider l’utilisateur, que les vrais absents ont une cause visible et que les décisions utilisateur survivent aux retries, migrations et réparations.

Les gates techniques sont : typecheck, tests unitaires, tests API/worker, build et smoke de queue. Voir [AGENT.md](../AGENT.md), [ADR 0022](adr/0022-premier-resultat-et-limites-anilist.md), [ADR 0023](adr/0023-review-interactive-correspondances-ambiguës.md) et la feuille de route dans [07-waves-et-tests.md](07-waves-et-tests.md).
