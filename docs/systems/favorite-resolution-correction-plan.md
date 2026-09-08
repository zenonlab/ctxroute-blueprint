# Correction complète FavLib → TobiRink

## Statut et autorité

Contrat cible v3, approuvé le 2026-09-08. Sa documentation ne constitue pas
une preuve d'implémentation. Progress conserve la validation de chaque étape.
La parité réelle reste non démontrée tant que l'oracle privé complet ne passe pas.

Référence historique : commit Git `3267de2`, notamment `CLAUDE.md` et
`docs/adr/0087-architecture-locale-favoris-resolution-agenda.md`. Le dernier
FavLib local-only n'est pas l'autorité normative. La demande utilisateur
du 2026-09-08 précise cette doctrine : Worker seul détenteur du binding D1,
propriétaire opaque détenu par l'extension, Kitsu en repli contrôlé, migrations
additives. Aucun code FavLib n'est porté ou exécuté dans TobiRink.

Ce contrat remplace les prescriptions contradictoires des versions 1/2 de
la spécification et de la pipeline. Les règles pures de parsing et les 82 cas
de la spécification restent une base de traçabilité, pas un oracle réel validé.

## Autorités et frontières

| Donnée | Autorité | Reconstruction et règle |
| --- | --- | --- |
| Présence, placement, progression observée | favoris navigateur | scan et événements; une baisse de progression exige confirmation |
| Artefacts, œuvres hydratées, tâches, décisions, agenda, caches | IndexedDB extension | transactions, versions, reçus, export privé |
| Identifiants fournisseurs | snapshot `storage.sync` | IDs seulement; aucune progression ou décision |
| Bootstrap, préférences, appairage, secrets propriétaire | `storage.local` extension | accès de confiance, jamais sync/site/logs |
| Clé normalisée ↔ IDs, choix propriétaires, confirmations | D1 via Worker | SQL minimal, aucune copie de catalogue fournisseur |
| Affichage web | projection WebBridge | aucune autorité ni accès D1, aucun secret propriétaire |

Un retrait navigateur détache la source et retire sa présence active de la
projection concernée; il ne supprime ni source mémorisée, ni œuvre, ni décision,
ni progression historique. Plusieurs favoris d'une œuvre sont conservés :
l'œuvre reste présente tant qu'une source attachée l'établit. Une saisie humaine
et une progression observée gardent des provenances distinctes; aucune fusion
ne prend silencieusement le maximum ou la dernière réponse réseau.

Les catalogues SQL existants restent séparés et conservés. Le collectif ne les
détourne pas et ne les peuple pas avec les titres issus des favoris. Les autres
fonctions produit déjà existantes ne sont pas supprimées par cette correction.

## Pipeline et résultat

```text
Favoris navigateur → capture transactionnelle → parsing local
  → ID fournisseur URL
  → règle exacte origine/route
  → artefact et aliases locaux validés
  → fiche hydratée compatible
  → lookup Worker/D1 par empreinte et propriétaire
  → recherche locale fournisseur puis hydratation exacte
  → décision persistée → projections locales
```

L'import écrit source, artefact et tâche dans une seule transaction; il ne crée
jamais de Review. `FavoriteSource.reviewId` est optionnel; une référence
présente doit être valide, mais une source sans Review n'est pas orpheline.
Le lien vers l'œuvre résolue ne dépend plus de l'existence d'une Review.

| Résultat de résolution | Effet | Cloche |
| --- | --- | --- |
| `RESOLVED` | identité unique hydratée, Work et reçu atomiques | aucune nouvelle Review |
| `REVIEW_REQUIRED / AMBIGUOUS` | plusieurs identités comparables au premier niveau probant | actionnable |
| `REVIEW_REQUIRED / NOT_FOUND` | recherche pertinente terminée sans correspondance | actionnable |
| `UNSUPPORTED` | entrée non média, route utilitaire ou exclusion documentée | diagnostic seulement |
| `RETRYABLE` | réseau, 429, timeout, réponse invalide/incomplète ou budget atteint | traitement/panne séparé |

`no-match` est exclusivement la décision humaine finale « aucune
correspondance ». Une absence automatique n'est jamais cette confirmation.
Un manque de preuve média n'est pas un introuvable fournisseur.
Un conflit explicite d'identité/saison devient ambiguïté; une corruption de
stockage devient diagnostic de réparation, jamais candidat humain fabriqué.

## Fournisseurs et matching

| Lane | Politique par titre |
| --- | --- |
| anime | AniList → Kitsu Anime seulement après `NO_MATCH` complet |
| manga/manhwa/manhua | MangaUpdates → MangaDex quand référence exacte ou responsabilité sorties applicable → Kitsu Manga après absence complète des recherches applicables |
| inconnu | lanes anime et manga indépendantes; deux résultats crédibles de types différents imposent Review |

Une référence AniList manga, MangaDex UUID, MangaUpdates ou Kitsu explicite
est hydratable directement. MangaDex ne devient pas une recherche générale
concurrente de MangaUpdates. `lastChapter` et `lastVolume` ne prouvent jamais la
progression personnelle. La nature Kitsu anime/manga fait partie de l'identité.

Panne, timeout, 429, réponse partielle et quota ne valent pas `NO_MATCH`.
Ils ne déclenchent pas le palier suivant comme arbitre. Kitsu ne départage
jamais une ambiguïté principale. Si une lane UNKNOWN reste incomplète, l'autre
ne peut pas établir à elle seule une unicité inter-types.

Le matcher déduplique par couple fournisseur/ID, puis s'arrête au premier
niveau probant : ID exact, URL exacte, titre exact, saison corroborée, même
multiensemble de mots significatifs, distance bornée. Zéro identité permet le
niveau suivant, une seule résout, plusieurs imposent Review. Les références
de fournisseurs différents ne sont regroupées comme une même œuvre que par
une association explicite validée, jamais par titre seul.

Distance maximale : zéro si un titre compact a moins de cinq caractères;
sinon `min(2, max(1, floor(max(longueurA, longueurB) / 8)))`.
Les séquences numériques doivent rester identiques. Ce plancher permet une
faute unique comme `Frieran` → `Frieren`, sans rapprocher `20` de `21`.
Les nombres intrinsèques et les saisons restent préservés; année, popularité,
premier résultat, image, couverture de tokens et ordre API ne prouvent rien.

Une réponse valide et paginée n'est pas une panne. L'adaptateur distingue
validité du payload, curseur, `hasMore` et exhaustivité de la recherche
pertinente. Il persiste les pages/aliases et accumule les identités distinctes
au niveau probant sans charger le catalogue. Vingt candidats est une borne
par page, pas une preuve d'unicité; trois aliases au plus sont dédupliqués.
Une réponse incomplète ne produit ni résolution automatique ni fallback.
Un budget épuisé conserve le curseur et `RETRYABLE`; répéter huit fois la même
première page n'est pas une stratégie de pagination. Deux identités déjà
prouvées au même niveau suffisent à établir l'ambiguïté, sans prétendre que la
liste des candidats affichés est exhaustive.

Les cadences sont persistées avant l'effet : AniList au moins 2 200 ms,
MangaUpdates 3 000 ms; Kitsu et MangaDex ont chacun une lane bornée avec
`Retry-After` prioritaire. Une requête dure au plus 8 s, un réveil 20 s et
huit tâches, un claim 60 s. Après huit erreurs automatiques, la tâche reste
reprenable manuellement, classée `RETRYABLE`, hors cloche.

## Règles de sites

Le Worker distribue un document JSON strict versionné : version du schéma,
révision des règles, origine HTTPS exacte, segments littéraux de route,
positions d'identité, média et progression, marqueurs saison/sortie bornés.
Maximum 100 règles, 32 segments par route, 64 Kio par document; valeurs et
positions hors bornes sont refusées avant activation. Pas de JavaScript,
regex distante, joker d'origine, import dynamique ou exécution de code distant.
Les segments sont décodés une fois; séparateurs encodés et chemins ambigus
échouent fermés. Deux règles incompatibles ne sont jamais départagées par ordre.
La dernière révision validée reste utilisable hors ligne; un downgrade ou un
document invalide conserve la version précédente. Une nouvelle règle invalide
seulement les artefacts qui en dépendent. Anime-Sama suit sa route anime/scan,
pas son nom de domaine; YouTube ordinaire ne possède aucune identité média.

## Sync et reconstruction

```ts
type SyncedProviderIds = {
  anilist: string[]; mangaUpdates: string[]; mangaDex: string[];
  kitsuAnime: string[]; kitsuManga: string[];
};
type SyncedProviderManifest = {
  schemaVersion: number; generation: number; fragmentCount: number;
  itemCount: number; byteLength: number; digest: string;
};
```

IDs validés par fournisseur, triés par points de code et dédupliqués. Le digest
SHA-256 porte une sérialisation canonique des cinq listes; `itemCount` compte
les IDs, `fragmentCount` les fragments. `byteLength` mesure les octets UTF-8 du
payload canonique. Le calcul de quota inclut en plus les clés, enveloppes et
manifestes réellement stockés, ainsi que l'ancienne génération et tout item
préexistant : chaque item <8 192 octets, total <102 400 octets et <512 items.

Publier les fragments d'une génération inédite, relire et vérifier le digest,
puis publier son manifeste en dernier. Conserver le manifeste antérieur et ses
fragments jusqu'à validation complète. Aucun lecteur ne mélange des générations.
Un manifeste obsolète, une interruption, un fragment manquant ou corrompu
conserve le dernier snapshot validé. Les événements sync sont coalescés,
écritures regroupées et espacées au moins de 2 s, maximum 120/min et 1 800/h.
La limite horaire impose une cadence durable supplémentaire; le débit instantané
ne suffit pas à la respecter. En cas de budget insuffisant, différer avec
diagnostic, jamais tronquer les IDs. La rétention de générations est bornée;
aucun nettoyage des anciennes clés n'est lancé dans ce chantier sans accord
sur les clés exactes. Tant que cet accord manque, conserver et suspendre les
publications qui dépasseraient le budget.

`TRUSTED_CONTEXTS` est appliqué lorsque disponible. Firefox impose la même
frontière par architecture : aucun content script ne lit le storage, tous
passent par messages typés au background. Les secrets, titres, URLs,
progressions, agenda, décisions et enveloppes de clés sont interdits en sync.
Les anciennes enveloppes restent lisibles localement pour compatibilité,
mais ne sont plus écrites vers sync; aucune donnée existante n'est effacée.

Reset : rescan favoris → snapshot sync validé → hydratation exacte → aliases
locaux → parsing → résolution. Les IDs ne recréent pas un historique privé
perdu; export et backup chiffré demeurent des moyens distincts de restauration.
Les installations concurrentes fusionnent des ensembles d'IDs validés; une
génération n'est pas une horloge globale atomique de navigateur sync. Une
collision de génération avec digest différent exige réconciliation/republication,
jamais « dernier écrivain = vérité ». Une décision owner-scoped n'est pas sync.

## Collectif SQL et authentification

Migration additive dans `apps/worker/migrations`, tables nouvelles séparées :

| Table logique | Clé/index utile | Responsabilité |
| --- | --- | --- |
| règles parsing | révision, état publié | document déclaratif borné |
| propriétaires | owner opaque | statut/empreintes de credentials |
| installations | owner + installation | appairage, révocation, quota |
| clés normalisées | version normalisation + média + SHA-256 | lookup sans titre brut |
| associations personnelles | owner + clé + fournisseur + ID | plusieurs références publiques |
| décisions et conflits | owner + clé + révision | choix explicites conservés |
| confirmations | clé + association + owner unique | deux installations = une voix |
| nonces | owner + nonce unique | anti-rejeu atomique |
| reçus batch | owner + batch digest | idempotence/reprise vérifiable |

HTTP strict, corps ≤64 Kio, 50 clés ou associations par batch, 5 références
publiques au plus par association. Les données autorisées sont l'empreinte
normalisée, média, IDs publics, versions parser/matcher/règles, nonce et preuve
d'authentification propriétaire. Horodatage, owner effectif et quota sont
établis par le serveur. Pas de titre brut, URL, dossier, progression ou payload
provider. SHA-256 déterministe réduit les données transmises mais n'anonymise
pas cryptographiquement un titre devinable; ne jamais publier ces empreintes.

Le premier choix est immédiatement utilisable par son propriétaire. Un alias
partagé exige deux confirmations explicites de propriétaires distincts ayant
indépendamment la même clé; conflit conserve chaque préférence personnelle et
désactive l'arbitrage collectif automatique. Les confirmations ne constituent
pas une preuve contre plusieurs propriétaires malveillants coordonnés.

Le Worker vérifie propriétaire actif, installation appairée, authentification,
nonce, version, taille et quota avant effet. Nonce, décision, confirmation et
reçu sont écrits atomiquement par `D1.batch` avec SQL préparé. Un retry du même
batch authentifié restitue son reçu; réutiliser son nonce avec un contenu
différent est refusé. Lier le digest de requête au reçu empêche l'ambiguïté.
Le lookup est groupé, owner-scoped prioritaire; les index couvrent les filtres
et projections pour éviter N+1 et scans globaux. `EXPLAIN QUERY PLAN` et mesures
de rows_read sont des preuves requises, pas des suppositions.

Identité opaque et secrets sont créés et détenus par l'extension. L'appairage
d'une autre installation est explicite et à durée limitée. D1 ne reçoit que
des empreintes de secrets, jamais leur clair. Site/sessions/WebBridge ne
créent pas de credentials, n'appairent pas d'installation et n'appliquent pas
de migration. Le binding D1 existe uniquement dans la composition Worker.
Le code d'authentification est testé avec secrets synthétiques; l'utilisation
de credentials réels reste une opération explicitement autorisée séparément.

## Versions et migration locale

Versions indépendantes : schéma d'export, stockage, parser, progression,
matcher, normalisation de clé, règles de sites, décision et reçu. Les versions
historiques sont lues, pas réinterprétées silencieusement. Les exports existants
restent importables; la nouvelle version conserve les sources sans Review.

Une migration additive ajoute état de résolution, lien Work direct, provenance
humaine/automatique et reçus de transformation. La migration ne déduit jamais
« automatique » de l'absence seule d'un nouveau champ. Une décision resolved
ou no-match d'origine incertaine est préservée comme protégée jusqu'à preuve.
Une pending artificielle est reconnue par sa provenance d'import/artefact et
l'absence de décision humaine; sinon elle reste protégée, avec diagnostic.
Les pending artificielles sont archivées logiquement hors cloche; sources,
Reviews et décisions restent présentes. Reparse et nouvelle tâche utilisent
la version corrigée et une clé idempotente distincte.

Chaque tranche de 100 au plus écrit transformations et reçu/cursor ensemble.
Un crash reprend au reçu sans refaire les décisions humaines. Les décisions
automatiques invalidées appartiennent seulement à l'allowlist des versions
fautives constatées; une version inconnue n'est pas invalidée par comparaison
lexicale. Reconstruction des IDs sync depuis les références exactes locales.
Rollback : code compatible avec les anciens et nouveaux champs; jamais de
down-migration destructrice. Les tests travaillent sur copies synthétiques.

## Review

Cloche = ambiguïtés et introuvables terminaux actionnables seulement.
Traitement en cours, panne et unsupported ont des états distincts hors cloche.
Afficher raison, provenance, niveau de matching et six candidats comparables
au plus, avec indication si d'autres candidats existent. Choix, ID/source
manuel exact, report et confirmation no-match relisent la révision avant commit.
Un ID public manuel peut être hydraté sans exiger sa présence préalable en
bibliothèque. Un report garde la décision ouverte sans fabriquer de no-match.
Toute décision finale met à jour source, Work éventuelle, Review et reçu dans
la même transaction. Les liens ordinaires restent hors cloche.

## Matrice des 30 écarts

Les identifiants G sont conservés depuis l'audit pour ne pas perdre la traçabilité.

| Écart | Correction et preuve requise | Étape |
| --- | --- | --- |
| G-01 | inventaire HTTP(S) distinct de média; unsupported persistant | 2,3 |
| G-02 | zéro Review créée à import, transaction source/artefact/tâche | 2 |
| G-03 | YouTube watch/shorts/root non pertinents exclus | 3 |
| G-04 | aucun slug arbitraire sans preuve origine/route | 3 |
| G-05 | validité page distincte d'exhaustivité; curseur durable | 3 |
| G-06 | unicité seulement au premier niveau complet pertinent | 3 |
| G-07 | progression pagination; panne retryable sans boucle page 1 | 3 |
| G-08 | requête cloche par état actionnable uniquement | 6 |
| G-09 | résultats explicites séparés de la tâche technique | 2,6 |
| G-10 | versions et oracle de tous les comportements historiques | 3,7 |
| G-11 | règles déclaratives Worker et routes Anime-Sama | 3,5 |
| G-12 | aliases avec preuve d'identité/provenance | 3 |
| G-13 | langue locale reste enrichissement facultatif sans arbitrage | 3,7 |
| G-14 | trois aliases max, déduplication, curseur/reprise | 3 |
| G-15 | claims/effets/projection/reçu atomiques; crash à chaque limite | 2,6,8 |
| G-16 | Kitsu uniquement après NO_MATCH complet | 3 |
| G-17 | AniList manga et MangaDex explicites hydratables | 3 |
| G-18 | aliases/hydratation locale avant D1 puis recherche | 3,5 |
| G-19 | reçus locaux versionnés et provenance bornée | 2,6 |
| G-20 | progression rattachée au favori exact résolu; source fraîche | 2,6 |
| G-21 | NOT_FOUND actionnable puis no-match humain | 2,6 |
| G-22 | actions manuelles validées, révision/type/domaine vérifiés | 6 |
| G-23 | grand inventaire, plusieurs réveils, mutation concurrente | 8 |
| G-24 | doctrine 3267de2, ADR/spec/pipeline/Archify cohérents | 1 |
| G-25 | oracle réel privé lu seul et synthétiques indépendants | 7 |
| G-26 | preuves unitaires/oracle/installation/production distinctes | 7,8 |
| G-27 | migration additive reçue, décisions humaines préservées | 6 |
| G-28 | favoris autorité présence/progression; sync IDs/reconstruction | 2,4 |
| G-29 | liens ordinaires hors cloche, source jamais supprimée | 3,6 |
| G-30 | collectif clé/owner/IDs, isolation, anti-rejeu, SQL borné | 5 |

## Équivalence et oracle réel

| Dimension | Comparaison | Différence admissible |
| --- | --- | --- |
| Artefact | brut local, transformations, identité, aliases, provenance | structure JSON différente avec mapping explicite |
| Média | anime/manga/manhwa/manhua/inconnu | correction route documentée |
| Progression | nature, valeur, saison, source et rejets | aucune invention; correction motivée |
| Identité | fournisseur + ID, aliases explicitement liés | meilleure résolution justifiée |
| Décision | resolved/ambigu/not-found/unsupported/retryable/no-match humain | états techniques reclassés explicitement |
| Raison | niveau de preuve et conflit | aucun écart inexpliqué |

La base FavLib est consultée en lecture seule hors dépôt. Aucun titre, URL,
export privé ou résultat individuel n'entre dans Git, logs, CI ou captures
partagées. Les fixtures synthétiques reproduisent des formes, pas la bibliothèque.
Un rapport privé local garde cause et résultat de chaque différence. Le bilan
« environ 40 ambiguïtés, 4 introuvables » est une référence utilisateur à mesurer,
pas une assertion que l'on force. Le bilan synthétique 77/4/1 est historique;
MangaDex X-01 rejoint désormais la validation. Aucune différence non expliquée
ne passe; une divergence finale non couverte par une décision approuvée exige
l'accord utilisateur.

## Exécution, validation et publication

Le snapshot synthétique du parser v3 change les versions et fingerprints.
Deux corrections de fixtures sont explicites : U-04 injecte désormais une
preuve d'ID AniList exact; S-04 conserve le titre précédant `season4`, plutôt
que de prendre ce marqueur pour le titre. Les tests de routage et de reprise
exécutent séparément l'import, les adaptateurs et les transactions. Ce snapshot
ne prouve pas la parité avec la base privée, réservée à l'étape 7.

Huit étapes dans Progress, chacune avec fichiers, commandes, critères et commit :
documentation; contrats; parser/fournisseurs; sync; Worker SQL; migration/Review;
oracle privé; vérification complète. La documentation est validée et committée
avant tout code produit. Les corrections restent dans les périmètres approuvés.

Commandes documentaires : `npm run validate:decisions`,
`npm run validate:docs -- --all`, `npm run validate:coherence`,
`npm run archify:validate -- all`, `git diff --check`.
Puis tests domain/application/contracts/adapters/extension/Worker, migrations
IndexedDB Chromium/Firefox, D1 local, quotas, sécurité, MV3, oracle, Review et
WebBridge; budgets mémoire/requêtes/SQL/temps; `npm run verify`, CRG et audit
dépendances. Aucune installation de dépendance n'est autorisée implicitement.

Les ZIP 1.0.0 sont construits deux fois dans des sorties isolées et leurs hashes
doivent être égaux; les tests de paquets réellement installés sont obligatoires.
Les ZIP publiés ne sont pas remplacés. Push, fusion, migrations D1 production,
remplacement ZIP et déploiement Worker forment une dernière opération séparée :
plan exact, allowlist, hashes, sauvegarde Worker précédent, rollback testé et
approbation explicite. Toute preuve manquante est signalée, jamais marquée verte.

## Sources publiques

- [AniList rate limiting](https://docs.anilist.co/guide/rate-limiting) : la demande
  fixe le budget prudent à 30/min; la page a répondu 403 lors de l'inspection
  du 2026-09-08. Les en-têtes réels peuvent ralentir davantage la lane.
- [Documentation Kitsu](https://github.com/hummingbird-me/api-docs) : couvre les
  ressources anime/manga; ce périmètre ne lui donne pas une priorité métier.
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
  et [Firefox sync](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)
  : quotas de stockage et particularités de synchronisation, consultés le 2026-09-08.
