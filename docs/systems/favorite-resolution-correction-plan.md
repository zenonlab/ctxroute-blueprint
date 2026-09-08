# Correction complète FavLib → TobiRink

## Statut et autorité

Contrat cible v3, approuvé le 2026-09-08. Sa documentation ne constitue pas
une preuve d'implémentation. Progress conserve la validation de chaque étape.
La conformité est démontrée par les contrats TobiRink, le corpus clean-room et
les validations d'intégration; elle ne dépend d'aucune base FavLib.

Référence historique : commit Git `3267de2`, notamment `CLAUDE.md` et
`docs/adr/0087-architecture-locale-favoris-resolution-agenda.md`. Le dernier
FavLib local-only n'est pas l'autorité normative. La demande utilisateur
du 2026-09-08 précise cette doctrine : Worker seul détenteur du binding D1,
propriétaire opaque détenu par l'extension, Kitsu en repli contrôlé, migrations
additives. Aucun code FavLib n'est porté ou exécuté dans TobiRink.

Ce contrat remplace les prescriptions contradictoires des versions 1/2 de
la spécification et de la pipeline. Les règles pures de parsing et les 82 cas
de la spécification constituent le corpus de régression clean-room.

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

Les clés de fragments et manifestes contiennent génération et digest : deux
installations ne peuvent écraser un contenu différent sous la même clé.
Le lecteur valide chaque génération complète puis réunit leurs IDs, afin de
préserver aussi les ajouts concurrents. Aucune suppression d'ID n'est inférée.
Les générations incomplètes ou corrompues sont ignorées; les anciennes restent
lisibles. Une publication conserve son payload d'IDs en attente dans local,
réserve sa cadence avant chaque effet et écrit son manifeste en dernier.
L'intervalle minimal de 2 100 ms borne également les écritures sur une heure
glissante. Un scan Work et une hydratation de restauration reprennent par
curseurs bornés; les fiches récupérées ne créent ni favori ni Review.
Le checkpoint de scan/restauration appartient à IndexedDB v11, ajouté sans
transformation des anciennes lignes. Un reset de cette base réinitialise donc
sa reconstruction; une simple fiche fournisseur introuvable ne simule pas un
reset. La cadence et la publication sync en attente restent dans storage.local.

Le raccordement background conserve sync sur Firefox avec une restriction
applicative explicitement sélectionnée à la compilation. Chromium exige
`setAccessLevel`; une API présente mais défaillante interdit toujours l'accès.
Les contrats IndexedDB et migrations v1/v2/v3/v4/v5/v8/v9/v10
vers v11 passent dans Chromium et Firefox 151.0 de test. Le script
`FIREFOX_BIN=<exécutable installé> node packages/adapters-indexeddb/scripts/firefox-contract.mjs`
réutilise le Playwright déjà présent dans le workspace web; il ne télécharge
aucun navigateur. Il teste IndexedDB dans des pages locales, pas une extension
Firefox installée ni la synchronisation entre comptes réels.

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

Implémentation v2 : `/v2/favorites/owners`, `/pairings/redeem`, `/batches` et
`/rules` sous le même préfixe. L'extension propose un consentement décoché,
une invitation à usage unique de cinq minutes et une révocation de tous les
appareils. Seule sa page options peut émettre ces commandes; WebBridge ne
connaît ni cette API locale ni les credentials. Le Worker conserve seulement
les empreintes de tokens de 32 octets aléatoires; 16 installations au plus
peuvent être appairées à un propriétaire. Les invitations consommées et les
décisions historiques ne sont pas supprimées.

La migration `0004_favorite_owner_resolution.sql` sépare `favorite_owners`,
`favorite_installations`, `favorite_pairings`, `favorite_keys`,
`favorite_choices`, `favorite_confirmations`, `favorite_receipts`,
`favorite_decisions`, `favorite_daily_quotas` et `favorite_site_rules`.
Les triggers maintiennent les compteurs de confirmations dans le batch du
choix. Un upsert automatique ne remplace jamais un choix humain confirmé.
La clé SQL dérive de la version de normalisation, du média et de l'empreinte;
les versions parser/règles restent une provenance dans la clé et le journal,
sans cloisonner une même identité selon le site d'origine du favori.
Le lookup consulte un choix personnel ou au plus deux identités partagées
actives via index couvrant. Plusieurs identités actives interdisent le choix
partagé, même si l'une a plus de confirmations. Un choix owner peut résoudre
une ambiguïté locale; un résultat partagé ne la départage pas.

Un lot de 50 clés utilise cinq statements D1, lectures d'authentification et
de reçu comprises; sa projection est calculée dans le même batch que le nonce.
Les tests mesurent les rows_read et vérifient les plans d'index. Les champs
additionnels privés, cookies de session et corps de plus de 64 Kio sont refusés.
Le lecteur HTTP borne aussi les flux sans Content-Length avant assemblage.

Le background prépare les lookups par pages de 50 sources et conserve leur
cache privé : MISS 15 minutes, FOUND 24 heures, 10 000 clés au maximum.
Les changements de choix invalident la clé concernée. Son outbox local garde
nonce et commande avant effet; activation, appairage, contribution et révocation
reprennent après redémarrage. Les règles validées restent utilisables hors ligne.
Les règles publiées en SQL sont vérifiées par SHA-256; leur publication reste
une opération de la gate, sans route de mutation de schéma ou de règles.
Le rollback opérationnel rétablit le Worker précédent et laisse la migration
additive en place, sans DROP ni perte du catalogue existant.

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

Chaque tranche de 100 au plus écrit transformations et reçus ensemble.
L'import reprend le curseur d'inventaire existant : correction, état précédent,
nouvel artefact et tâche sont écrits dans sa transaction de 100 favoris au plus.
Le reçu par source rend la reprise idempotente si l'inventaire s'interrompt
avant son prochain checkpoint. Une Review historique reste dans sa table;
son ancien lien est conservé dans le reçu lorsque la source est réenfilée.
Un crash reprend au reçu sans refaire les décisions humaines. Les décisions
automatiques invalidées appartiennent seulement à l'allowlist des versions
fautives constatées; une version inconnue n'est pas invalidée par comparaison
lexicale. Reconstruction des IDs sync depuis les références exactes locales.
Rollback : code compatible avec les anciens et nouveaux champs; jamais de
down-migration destructrice. Les tests travaillent sur copies synthétiques.

## Review

Cloche = ambiguïtés et introuvables terminaux actionnables seulement.
Traitement en cours, panne et unsupported ont des états distincts hors cloche.
Les paramètres de l'extension affichent ces trois compteurs issus des index de
sources observées. Aucun lien ordinaire ne devient une entrée de Review pour
expliquer son exclusion; les compteurs restent privés et se rafraîchissent à
la demande, sans requête fournisseur.
Afficher raison, provenance, niveau de matching et six candidats comparables
au plus, avec indication si d'autres candidats existent. Choix, ID/source
manuel exact, report et confirmation no-match relisent la révision avant commit.
Un ID public manuel peut être hydraté sans exiger sa présence préalable en
bibliothèque. Un report garde la décision ouverte sans fabriquer de no-match.
Toute décision finale met à jour source, Work éventuelle, Review et reçu dans
la même transaction. Les liens ordinaires restent hors cloche.
Le site transmet les motifs, la provenance et le niveau de preuve reçus du
WebBridge au composant partagé. Le report conserve la commande `defer`; il
n'est jamais traduit en confirmation `none`. Un test avec le vrai provider
WebBridge et des réponses de transport synthétiques vérifie ce raccord.

La sélection utilise le jeu de candidats effectivement comparé, conservé dans
IndexedDB. Une suggestion fournisseur peut créer la fiche locale lors du choix
humain; sa présence préalable en bibliothèque n'est pas une condition. La
révision inclut la résolution et le jeu comparé. Une hydratation manuelle se
prépare hors transaction, puis la transaction relit cette révision avant effet.
Une recherche terminée sans candidat est actionnable, jamais présentée comme
une panne fournisseur. Les champs additifs de Review restent importables avec
les exports antérieurs; les lignes archivées ne sont pas supprimées.
IndexedDB v12 ajoute l'index composé statut/échéance/ID. La cloche parcourt cet
index par pages de 100, avec un curseur échéance/ID et une échéance de lecture
fixe, jusqu'à obtenir 100 cas actionnables ou atteindre la fin. Les anciennes
lignes liées à une source retirée ou en traitement ne masquent pas les suivantes.
La mémoire reste bornée à une page et au résultat. Les Reviews terminales
en attente deviennent disponibles; le report humain écrit une échéance à
24 heures, préservée dans l'export. Une saisie `fournisseur:identifiant` ou une
URL fournisseur exacte utilise les ports d'hydratation et leur cadence; un ID
nu reste limité à une identité locale unique pour ne pas deviner son fournisseur.
La validation installée utilise un profil Chromium isolé et les commandes CDP
du navigateur. Elle vérifie l'import réel d'un lien exclu, zéro ligne Review
créée et l'affichage de l'état local. Sans origine de site configurée, aucun
content script n'est enregistré dans le manifeste. Chrome 140 est le minimum
déclaré pour la restriction native des zones de stockage utilisées.

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
| G-10 | versions et corpus clean-room des comportements retenus | 3,7 |
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
| G-25 | corpus synthétique indépendant, sans accès aux données FavLib | 7 |
| G-26 | preuves unitaires/corpus/installation/production distinctes | 7,8 |
| G-27 | migration additive reçue, décisions humaines préservées | 6 |
| G-28 | favoris autorité présence/progression; sync IDs/reconstruction | 2,4 |
| G-29 | liens ordinaires hors cloche, source jamais supprimée | 3,6 |
| G-30 | collectif clé/owner/IDs, isolation, anti-rejeu, SQL borné | 5 |

## Contrat de régression clean-room

| Dimension | Comparaison | Différence admissible |
| --- | --- | --- |
| Artefact | brut local, transformations, identité, aliases, provenance | structure JSON différente avec mapping explicite |
| Média | anime/manga/manhwa/manhua/inconnu | correction route documentée |
| Progression | nature, valeur, saison, source et rejets | aucune invention; correction motivée |
| Identité | fournisseur + ID, aliases explicitement liés | meilleure résolution justifiée |
| Décision | resolved/ambigu/not-found/unsupported/retryable/no-match humain | états techniques reclassés explicitement |
| Raison | niveau de preuve et conflit | aucun écart inexpliqué |

Aucune base, aucun export, aucun titre privé et aucune URL FavLib ne sont lus
par la validation. Les 82 fixtures synthétiques reproduisent uniquement les
formes et décisions revues nécessaires au contrat TobiRink. Le bilan 77/4/1
classe ces cas synthétiques; le repère historique « environ 40 ambiguïtés,
4 introuvables » n'est ni une cible ni un critère d'acceptation. MangaDex X-01
rejoint désormais la validation. Toute divergence du corpus doit être expliquée
par une décision versionnée.

## Exécution, validation et publication

Le snapshot synthétique du parser v3 change les versions et fingerprints.
Deux corrections de fixtures sont explicites : U-04 injecte désormais une
preuve d'ID AniList exact; S-04 conserve le titre précédant `season4`, plutôt
que de prendre ce marqueur pour le titre. Les tests de routage et de reprise
exécutent séparément l'import, les adaptateurs et les transactions. Ce snapshot
prouve le contrat synthétique; les tests navigateur et Worker vérifient ensuite
son intégration réelle dans TobiRink.

Huit étapes dans Progress, chacune avec fichiers, commandes, critères et commit :
documentation; contrats; parser/fournisseurs; sync; Worker SQL; migration/Review;
corpus clean-room; vérification complète. La documentation est validée et committée
avant tout code produit. Les corrections restent dans les périmètres approuvés.

Commandes documentaires : `npm run validate:decisions`,
`npm run validate:docs -- --all`, `npm run validate:coherence`,
`npm run archify:validate -- all`, `git diff --check`.
Puis tests domain/application/contracts/adapters/extension/Worker, migrations
IndexedDB Chromium/Firefox, D1 local, quotas, sécurité, MV3, corpus, Review et
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
