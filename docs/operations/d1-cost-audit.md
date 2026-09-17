# Audit des coûts D1 et parcours de certification

Date : 17 septembre 2026. État : référence 0021 et cible Agenda virtuel/R2 mesurées localement; certification distante de la cible en attente.

Le [plan maître A à Z](./tobirink-a-z-master-plan.md) est la source de vérité
pour l'ordre d'exécution, les seuils proposés et les frontières d'approbation.

## Verdict

Le nombre de lignes conservées n'est pas le nombre d'écritures.
Une fiche synthétique de dix lignes catalogue coûte **55 écritures dans la
fixture 0021 uniquement** pour
son admission, son traitement et sa publication. Aucun appel fournisseur n'est
inclus dans ces 55 écritures.

La déduplication d'une même clé et les lectures VERIFIED fraîches passent sans
écriture. Une autre clé pour la même œuvre coûte 19 écritures de cycle, mais ne
crée plus de révision et ne réécrit plus sa fiche catalogue. Le rafraîchissement
inchangé ou sans changement dans les champs matériellement persistés conserve
12 écritures de suivi.

Après retrait des quatre index strictement redondants par la migration 0022,
la même fixture courante mesure 49 écritures pour une première résolution,
15 pour une nouvelle clé de la même œuvre, 11 pour un rafraîchissement
identique ou partiel et 15 pour un changement de compteur. Les valeurs 55,
19, 12 et 16 restent ci-dessous comme référence historique 0021 ; elles ne
décrivent plus le schéma courant après 0022.

L'Agenda 0021 historique utilisait une projection active différentielle :
1 798 écritures au premier amorçage, 70 pour une collecte identique et 76–77
pour un événement modifié. La cible 0024 déplace lanes, pages, snapshots et
observations dans R2 et conserve un modèle D1 courant par œuvre. Sur la même
fixture de 579 œuvres, elle mesure 2 895 écritures D1 au premier amorçage, zéro
sur une collecte identique et cinq pour un événement modifié. Les opérations R2
correspondantes sont rapportées séparément ci-dessous.

Ces résultats ne reconstituent pas les 100 000 écritures historiques et ne
certifient pas le montant facturé en production. La projection
`1 000 × 55 = 55 000` n'est pas une
consommation observée. La taille d'une ligne ne multiplie pas son compteur
d'écritures; les index effectivement maintenus peuvent ajouter des écritures.

Les mesures de taille reproductibles utilisent exclusivement
`length(CAST(value AS BLOB))`. `length(TEXT)` compte des caractères et ne doit
plus être présenté comme un nombre d'octets. Le rapport cible ventile admission,
claim, publication, titres, index, compteurs, classification et reprises, puis
rapporte séparément lignes D1, octets, opérations R2, Queue, Worker et appels
fournisseur.

## Audit des répétitions et de l'utilité des appels

Cet audit porte sur le code exécuté, pas seulement sur les lignes conservées.
Une lecture répétée n'est supprimable que si elle ne protège ni la concurrence,
ni l'idempotence, ni la décision de ne pas écrire.

| Chemin | Appels D1 principaux | Utilité | Optimisation restante |
|---|---|---|---|
| Lookup unitaire | transition terminale éventuelle, puis lecture de l'état | La transition clôt un bail épuisé; la lecture retourne l'état public | Aucune suppression sûre identifiée |
| Lookup par lot | une requête `json_each` pour jusqu'à 50 clés | Évite un appel par clé et restitue aussi les MISS | Déjà le chemin optimal exposé |
| Admission Discovery | écriture atomique, puis lecture de l'état; reprise du signal si nécessaire | La lecture confirme saturation, conflit et état final après concurrence | Fusion possible seulement avec une nouvelle forme de retour SQL |
| Claim Discovery | `UPDATE ... RETURNING`, plus clôture bornée des claims épuisés | Sélection, bail et retour des demandes sont atomiques | Aucune lecture séparée à retirer |
| Publication Discovery | lecture de garde, comparaison catalogue, batch protégé par lease, relecture seulement après `changes=0` | Protège rejeu, collision, bail et publication partielle | Les gardes répétées sont le prix de l'atomicité; pas de suppression sûre |
| Relations Discovery historiques | lecture puis admission secondaire | Retirées du runtime cible; aucune relation ne crée de travail |
| Claim Agenda | lecture complète de lane puis `UPDATE ... RETURNING` | La lecture distingue complete/deferred/resume; l'UPDATE arbitre le lease | **Candidate** : décision + retour d'état dans une requête atomique |
| Page Agenda | batch de deux écritures : page et checkpoint lane | Les deux écritures doivent réussir ensemble pour reprendre sans trou | Aucune écriture inutile démontrée |
| Fin de lane | lecture de toutes les pages, relecture de lane, mise à jour conditionnelle | Pages pour le digest; lane pour le digest actif et le lease | **Candidate** : transporter `activeDigest` depuis le claim pour éviter la relecture |
| Publication Agenda | deux lectures de lanes en parallèle, lecture génération active, batch projection/diff/rétention | Données des deux lanes, no-op, fenêtre, concurrence temporelle et nettoyage | Aucune suppression sûre sans perdre ces garanties |
| Lecture Agenda publique | génération active puis projection courante | Version/window et pagination sont toutes deux consommées | Pas de doublon structurel |
| Catalogue détail | work, titres et références en parallèle | Trois projections distinctes demandées par la réponse | Parallélisme déjà correct |

### Taux de répétition observé

Les répétitions artificielles du banc (`100` admissions identiques et `100`
lectures VERIFIED) mesurent la déduplication, pas un comportement normal du
runtime. Le chemin réel répété est surtout Agenda : pour chaque lane, un claim
lit puis écrit l'état, chaque page écrit page + checkpoint, puis la fin relit
les pages et l'état. La relecture de lane dans `completeLane` est la seule
répétition clairement candidate à supprimer sans changer les données produites.

Les écritures de suivi ne sont pas du slop : leases, checkpoints, états
terminaux, nonce, projection active et suppression des événements absents
portent chacun une garantie distincte. Les compteurs locaux confirment que les
rejeux ne réécrivent pas le catalogue (`0` écriture pour les doublons testés).
Pour Agenda 0024, une collecte identique écrit zéro ligne D1 et un événement
changé en écrit cinq, contre respectivement `70` et `76–77` dans la référence
0021. R2 conserve toutefois 32 écritures opérationnelles dans chacun de ces
cycles.

## Méthode et reproductibilité

Source exécutable : [banc de mesure](../../apps/worker/src/cost-baseline.test.ts).
Moteur local workerd/D1 via le plugin Cloudflare déjà installé, migrations du
dépôt jusqu'à 0021, sans modification de dépendance.

Commande de reproduction avec sortie des compteurs :

```sh
npm run test --workspace @tobirink/worker -- src/cost-baseline.test.ts --reporter=verbose --silent=false
```

Le wrapper existant additionne uniquement les métadonnées
`D1Result.meta.rows_read/rows_written`. Les migrations, la préparation explicite
hors blocs mesurés et les SELECT de contrôle du stock sont exclus.
Les tests utilisent des identifiants et titres synthétiques, sans dump privé.
Les résultats fournisseur sont injectés : **zéro requête HTTP fournisseur**,
pas de simulation de CPU, de tarif Queue, de réseau ou de latence distante.
Le test du contrôle fournisseur mesure ses opérations D1 sans lancer HTTP.

Les lectures dépendent de la taille et de l'état des tables : elles ne constituent
pas un coefficient universel. Les assertions figent les écritures du scénario
Discovery et des cinq cycles Agenda pour rendre une dérive visible.
Un changement légitime de schéma doit donner lieu à une nouvelle mesure, pas à
une mise à jour aveugle des chiffres attendus.

Les tableaux correspondent à l'exécution du fichier complet dans son ordre
déclaré. Les migrations sont idempotentes, mais ne remettent pas à zéro la base
entre chaque test : les scénarios suivants peuvent retrouver des révisions et
des lignes des scénarios précédents. Les fixtures de nouvelles œuvres ont des
identifiants distincts. Exécuter un seul test isolément peut donc modifier les
lectures et la création d'une révision commune ; reproduire la commande complète.

## Discovery : mesures locales

Fixture : une œuvre, quatre titres distincts normalisés, une référence AniList,
aucune relation. Stock final : 1 fiche + 4 titres + 4 clés canoniques + 1 référence
= **10 lignes**, hors demandes, révisions, nonces et index.

| Opération | Lignes lues | Écritures |
|---|---:|---:|
| Nouvelle demande | 11 | 5 |
| Confirmation du signal Queue | 3 | 4 |
| Attribution au collecteur | 20 | 4 |
| Publication de la fiche à quatre titres et métadonnées canoniques | 59 | 44 |
| **Total première résolution, hors fournisseur** | **93** | **57** |
| 100 admissions identiques pendant PENDING | 1 400 | 0 |
| 100 lectures VERIFIED unitaires | 400 | 0 |
| Lookup groupé contenant une clé VERIFIED | 3 | 0 |
| Admission identique déjà VERIFIED | 14 | 0 |
| Nouvelle clé aboutissant à la même œuvre, cycle complet | 69 | 19 |
| Refresh identique : admission, confirmation, claim, publication | 37 | 12 |
| Refresh avec compteur changé | 159 | 16 |
| Refresh partiel préservant les champs connus | 37 | 12 |
| Réservation fournisseur + succès | 4 | 2 |
| Réservation fournisseur + échec | 4 | 2 |

Les 19 écritures de la nouvelle clé démontrent la distinction clé/œuvre : elles
proviennent du cycle de demande, signal et claim, tandis que le compteur de
révisions catalogue reste inchangé. La fixture ne prétend pas reproduire toutes
les variantes du parseur de favoris.
Le test de lookup avec une clé ne mesure pas un lot de cinquante clés.

### Octets et copies de profils

La fixture mesure les chaînes persistées avec
`length(CAST(colonne AS BLOB))`, jamais avec `length(TEXT)`. Après publication
d'une deuxième clé vers la même œuvre, les deux lignes VERIFIED contiennent
deux copies identiques du profil : 2 copies, 1 valeur distincte et 678 octets
JSON cumulés. Après modification du compteur d'épisodes, la clé rafraîchie et
l'alias ancien portent 2 profils distincts pour 696 octets cumulés. Le
catalogue relationnel correspondant contient
15 octets de titre préféré, 59 octets de titres et 6 octets de référence.

Ce résultat prouve la duplication actuelle dans `result_json`; il ne mesure ni
la taille des pages SQLite, ni les octets d'index, ni une facturation distante.
La future fiche canonique doit ramener le profil courant à une seule copie sans
effacer les clés de résolution.

### Échecs et ancienne exploration relationnelle

| Scénario | Lignes lues | Écritures |
|---|---:|---:|
| Admission d'une demande qui échouera | 11 | 5 |
| Huit claims avec expiration du bail | 208 | 32 |
| Première lecture après épuisement : transition FAILED | 5 | 3 |
| Lecture UNAVAILABLE suivante | 3 | 0 |
| Publication historique d'une fiche à un titre et une relation | 88 | 28 |
| Confirmation historique du signal de l'œuvre liée | 3 | 4 |
| Rejeu du même résultat et du même nonce | 36 | 0 |

Les huit claims coûtent **40 écritures avec admission et clôture**, hors
confirmation du signal initial et hors contrôle/appels fournisseur.
Il s'agit d'expirations de baux synthétiques, pas de huit erreurs HTTP réelles.
Ces deux lignes sont une référence 0021 antérieure au retrait de l'exploration.
Le runtime cible n'écrit plus de relation et n'admet plus l'œuvre cible.

La lecture unitaire n'est pas universellement sans écriture : elle clôt une
demande PROCESSING épuisée. Ne pas promettre zéro écriture pour tout GET.

## Agenda : mesures locales

Fixture commune : 220 événements AniList et 359 MangaUpdates, cinq et huit
pages de cinquante événements au maximum. La fenêtre reste fixe pour isoler la
détection de changement. Chaque cycle couvre claim, pages, fin des deux lanes et
publication fusionnée, sans appel HTTP fournisseur.

### Cible 0024 — modèles courants D1 et opérations R2

| Cycle | Lectures D1 | Écritures D1 | Lectures R2 | Écritures R2 | Publication |
|---|---:|---:|---:|---:|---|
| Premier amorçage, 579 œuvres / 13 pages | 7 529 | 2 895 | 786 | 391 | 579 modèles initialisés |
| Collecte identique, horodatage différent | 3 474 | 0 | 425 | 32 | Aucun modèle réécrit |
| Un événement changé, cycle 2 | 3 487 | 5 | 425 | 32 | Un modèle et sa révision |
| Un événement changé, cycle 3 | 3 487 | 5 | 425 | 32 | Un modèle et sa révision |
| Un événement changé, cycle 4 | 3 487 | 5 | 425 | 32 | Un modèle et sa révision |

Stock cible vérifié : **579 modèles courants** et **zéro page Agenda D1**. Le
premier coût D1 est supérieur à 0021 parce qu'il crée une ligne de modèle
indexée et actualise la révision de chacune des 579 œuvres. Le bénéfice porte
sur le régime récurrent : zéro écriture D1 pour une collecte identique et cinq
pour un changement isolé. Les 32 écritures R2 d'un cycle identique sont réelles :
elles correspondent aux leases, checkpoints et snapshots de reprise, pas à une
gratuité obtenue en déplaçant les opérations.

Les pages de travail R2 portent une échéance logique de sept jours. Un snapshot
actif et ses deux prédécesseurs restent référencés sans expiration automatique;
le pointeur n'est publié qu'après écriture et relecture du snapshot complet.
Les observations manga sont dédupliquées et bornées aux douze plus récentes.

### Référence historique 0021 — événements D1 matérialisés

| Cycle | Lignes lues | Écritures | Publication |
|---|---:|---:|---|
| Première réconciliation, 579 événements / 13 pages | 3 004 | 1 798 | Projection active initialisée |
| Collecte identique, horodatage différent | 156 | 70 | Aucune nouvelle génération |
| Un événement changé, deuxième génération | 3 660 | 76 | Diff d'un événement |
| Un événement changé, troisième génération | 3 667 | 76 | Diff d'un événement |
| Un événement changé, quatrième génération | 3 679 | 77 | Diff + rétention d'un snapshot |

Cette référence conservait 579 événements actifs, trois générations et treize
pages JSON. Elle reste utile pour la comparaison avant/après, mais ne décrit
plus le chemin de production visé par 0024.

### Reprise après interruption

| Opération | Lignes lues | Écritures |
|---|---:|---:|
| Claim | 3 | 1 |
| Sauvegarde de la première page | 2 | 4 |
| Enregistrement de l'échec | 1 | 1 |
| Réessai avant échéance | 1 | 0 |
| Reprise après échéance | 3 | 1 |
| Sauvegarde de la deuxième page | 2 | 4 |
| Fin de lane | 5 | 1 |
| Rejeu du déclenchement terminé | 1 | 0 |

Ce scénario utilise des pages vides pour isoler le checkpoint. Il vérifie le
refus de publication incomplète et la reprise à la page 2 avec le même
collection_id. Le coût de lecture du refus volontaire n'est pas dans le tableau.
Les premiers événements d'une génération interrompue et les échecs en plein
`db.batch` exigent une campagne distincte.

## Historique : ce qui est prouvé et ce qui ne l'est pas

La sauvegarde du 16 septembre examinée lors du diagnostic contient 99
générations pour 18 horaires distincts, 96 sans événement actuellement et trois
avec 579 événements. Le cron de l'ancien commit 0b44a59 est `*/10`, pas `*/5`.
Le hash ancien incluait la date du déclenchement et les horodatages de collecte.

La somme 99 × 579 = 57 321 est un nombre déclaré dans les générations, pas un
compteur d'insertions réussies. Une sauvegarde ne restitue pas les opérations
supprimées ni toutes les tentatives échouées. Les précédentes affirmations
« 231 000 écritures prouvées », « 1 737 événements actifs » et
« saturation en 3,57 heures » ne sont pas établies.

Illustration, sans attribution historique : 144 collectes quotidiennes × 579
insertions = 83 376 insertions. Leur renouvellement avec suppression des copies
anciennes peut dépasser 100 000 mutations avant même les index.
Le déficit historique exact reste à rapprocher des métriques Cloudflare.

## Capacité : œuvres et utilisateurs

Hypothèses de projection, **pas tests de charge exécutés** :
U utilisateurs, W œuvres par utilisateur, quatre titres et une référence par
œuvre, une clé par œuvre, résolution unique sans relation ni retry.
Tous les utilisateurs arrivent le même jour, depuis un catalogue initialement
froid. La colonne partagée suppose exactement les mêmes W œuvres et les mêmes
clés pour tous ; la colonne distincte suppose U × W œuvres différentes.

Les écritures sont le sous-total 55 × nouvelles œuvres.
La dernière colonne illustre une consultation unitaire de chaque œuvre par
chaque utilisateur une fois le catalogue chaud, selon 3 lectures observées par
GET dans la petite fixture ; ce n'est ni la mesure du lookup par 50 ni une
garantie à grande échelle.

| Utilisateurs U | Œuvres / utilisateur W | Écritures catalogue partagé | Écritures catalogues distincts | Lectures chaudes unitaires, projection |
|---:|---:|---:|---:|---:|
| 1 | 10 | 550 | 550 | 30 |
| 1 | 100 | 5 500 | 5 500 | 300 |
| 1 | 500 | 27 500 | 27 500 | 1 500 |
| 1 | 1 000 | 55 000 | 55 000 | 3 000 |
| 100 | 10 | 550 | 55 000 | 3 000 |
| 100 | 100 | 5 500 | 550 000 | 30 000 |
| 100 | 500 | 27 500 | 2 750 000 | 150 000 |
| 100 | 1 000 | 55 000 | 5 500 000 | 300 000 |
| 1 000 | 10 | 550 | 550 000 | 30 000 |
| 1 000 | 100 | 5 500 | 5 500 000 | 300 000 |
| 1 000 | 500 | 27 500 | 27 500 000 | 1 500 000 |
| 1 000 | 1 000 | 55 000 | 55 000 000 | 3 000 000 |
| 10 000 | 10 | 550 | 5 500 000 | 300 000 |
| 10 000 | 100 | 5 500 | 55 000 000 | 3 000 000 |
| 10 000 | 500 | 27 500 | 275 000 000 | 15 000 000 |
| 10 000 | 1 000 | 55 000 | 550 000 000 | 30 000 000 |

Coût marginal pour un utilisateur arrivant après le préremplissage :
zéro écriture sur les hits frais testés ; **55 × W** pour W nouvelles œuvres
dans cette fixture, avant les autres postes. Avec d'autres clés pour les mêmes
œuvres, une nouvelle résolution peut encore écrire : le partage du titre seul
ne garantit pas le partage de clé.

Pour D nouvelles œuvres, A nouvelles clés d'œuvres existantes, H refreshes
inchangés, M refreshes modifiés et P paires de contrôle fournisseur, le modèle
local indicatif est :

`writes = 57D + 19A + 12H + 16M + 2P + Agenda + échecs + autres écritures`.

Ces coefficients sont propres aux fixtures. La première publication d'une
révision commune peut être mutualisée par un batch; alias, références et index
changent aussi le coût. Les relations ne font plus partie du runtime cible. Ne
pas additionner deux fois le contrôle fournisseur dans un cycle déjà mesuré
intégralement.

Une moyenne hebdomadaire ne protège pas du pic d'un jour. Par exemple,
2 000 créations de cette fixture donnent 110 000 écritures avant Agenda.
Le stockage en Go, les requêtes HTTP, le CPU Worker, les messages Queue,
les images et la gateway ne se déduisent pas de ce tableau.

## Budget D1 et place de R2

Au 16/09/2026, D1 Free inclut 100 000 écritures et 5 millions de lectures par
jour ; le quota quotidien n'est pas un crédit mensuel transférable.
Workers Paid inclut 50 millions d'écritures D1 par mois, puis 1 USD par million
supplémentaire ; les lectures et le stockage ont leurs propres tarifs.
[Source officielle D1](https://developers.cloudflare.com/d1/platform/pricing/).

Workers Paid commence à 5 USD/mois, pas un prix garanti de 5 EUR TTC.
Le total peut inclure requêtes et CPU supplémentaires.
[Source officielle Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Illustration mensuelle du **seul sous-total d'écritures de création** :
un million de nouvelles œuvres à 55 écritures donnent 55 millions, soit 5 USD
d'écritures au-delà de l'inclus, plus la base Workers de 5 USD et tous les autres
postes. Une petite charge sous l'inclus ne produit aucun supplément d'écritures
D1, mais ne garantit pas une facture totale de 5 USD.

La cible conserve les données publiques courantes et filtrables dans D1, mais
déplace les demandes temporaires, leases, checkpoints, reprises et observations
bornées dans R2. Ce choix architectural doit être benchmarké en opérations A/B
et octets; il ne transforme aucune écriture en opération gratuite.

R2 Standard a une franchise mensuelle de 10 Go-mois, 1 million d'opérations A
et 10 millions B, avec tarification propre au-delà.
[Source officielle R2](https://developers.cloudflare.com/r2/pricing/).
Aucun abonnement, déplacement de données ou coût R2 du compte n'a été validé.

Décision : implémenter d'abord la cible R2/D1, reproduire les mêmes fixtures,
puis choisir Free/Paid après mesure distante des pics et de tous les postes,
avec une marge explicitement acceptée.

## Déploiement de la cible durable — 17 septembre 2026

Le candidat `e8d9b9d` a été poussé sur
`origin/perf/adaptive-public-refresh` après `npm run verify`. L’export D1 frais
`build/backups/tobirink-public-virtual-agenda-predeploy.sql`, ignoré par Git,
fait 965 788 octets et porte le SHA-256
`c86bfc65279464fa635da53d9014fce42661beaec37734ba92cdb24d0a7d064a`.

La gate `inspect → plan → apply` a limité l’opération à
`d1:tobirink-public` puis `worker:tobirink-public-api`. Le plan
`0b5e0284fce78fc5eafb8fe469abc9b529633b9df66099d7ed3bc40097b76034`
a appliqué uniquement `0023_catalogue_current_metadata.sql` et
`0024_virtual_agenda_models.sql`, puis déployé le Worker
`95be876e-2727-4b67-b278-c2891d30ea85` à 100 %. L’inspection suivante ne
trouve plus de migration en attente ; la route `tobirink.com/*`, le cron
`23 3 * * SUN` et le producteur/consommateur Queue sont présents.
Le correctif de transition `137b4b0` a ensuite été poussé et déployé seul sous
le plan `7b5ec5f2dc2601a68f7686f4ee36dcc18f77e877ad316ac2b0b79250ddfc1cdc` ;
le Worker courant `2e2e534b-7816-445c-992a-1576a7087ccd` sert 100 % du trafic.

Lecture post-déploiement, sans mutation :

| Preuve distante | Résultat |
|---|---:|
| fiches canoniques migrées | 5 |
| conflits d’identité | 0 |
| modèles Agenda avant le premier cycle hebdomadaire | 0 |
| événements legacy encore servis | 740 |
| lecture D1 de contrôle | 745 lignes lues, 0 écrite, `changed_db=false` |
| `GET /v4/release-models` | 200, collection vide valide |
| `GET /v3/releases` | 200, projection legacy compatible |
| objets R2 avant/après déploiement | 56 objets, 15,6 MB |

Le modèle Agenda sera amorcé par la prochaine collecte hebdomadaire réussie.
L’extension historique continue donc à lire `/v3/releases` pendant cette
transition ; la nouvelle extension n’est pas publiée dans cette étape. Les
lectures de vérification n’ont déclenché ni appel fournisseur, ni message
Queue, ni écriture D1/R2. L’observation native d’un cycle hebdomadaire complet
reste nécessaire avant de certifier les budgets distants de collecte.

La vue Archify
[`durable-catalogue-cost-certification.architecture.json`](../architecture/src/durable-catalogue-cost-certification.architecture.json)
sépare le runtime effectivement déployé, les budgets issus des fixtures et du
canari, et la certification hebdomadaire encore ouverte. Son artefact livré
porte le SHA-256
`f91aa273af518009224984b0c7c877b53cd97e95e8707763654794f89bfe7f6a` ;
la source porte le SHA-256
`1bb19d4e8c46329ee9a488edb4f2d882a2fa7a557f93c73e828b6a9cdccf54b5`.
La validation showcase passe 9 contrôles sur 9, sans erreur ni avertissement,
et le contrôle visuel passe en thèmes clair et sombre à 1440×900 et 2048×1320
sans débordement.

### Nettoyage des index et inventaire différé

La migration additive `0022_remove_redundant_discovery_indexes.sql` a retiré
les quatre index strictement redondants `public_discovery_v2_pending`,
`public_discovery_v2_failed_retention`,
`public_discovery_v2_nonce_retention` et
`catalogue_canonical_titles_v1_by_work`. La sauvegarde préalable ignorée par
Git fait 979 651 octets et porte le SHA-256
`6a6bde9e1f32caa7627a78d1747a165364fdca95e3ad8d00c465e20681379721`.
La gate a appliqué uniquement `d1:tobirink-public` sous le plan
`289eb834b55278a586cc19c12c670732d1ffb6b211b90eb59ec69e30576f488e`.

Les plans distants avant et après migration utilisent
`public_discovery_v3_pending`, `public_discovery_v3_failed_retention` et
`public_discovery_v3_nonce_retention`. La lecture canonique par œuvre utilise
désormais l’index automatique de la contrainte `UNIQUE`, dont les colonnes et
l’ordre sont identiques à l’index explicite retiré. Les quatre copies sont
absentes, aucune migration ne reste en attente et la taille D1 rapportée passe
de 1 298 432 à 1 273 856 octets, soit 24 576 octets libérés.

Le nettoyage relationnel séparément approuvé a utilisé la migration
`0025_drop_catalogue_work_relations.sql`. Le préflight distant a confirmé zéro
ligne et aucune référence runtime; la sauvegarde préalable
`tobirink-public-pre-orphan-cleanup-2026-09-17.sql` fait 978 242 octets et porte
le SHA-256
`16261b340b2e1118e3a5f9b6a7f59fbc10a20a2b957e7bbdf1500aee31c23f76`.
Le plan
`b3a217a0561d3174499527b46dc21732ebd565981b5c7ee1937c38e9b03bae38`
a retiré uniquement la table historique, ses index propriétaires et la Queue
orpheline `tobirink-jobs-production`. La taille D1 rapportée est passée de
1 273 856 à 1 257 472 octets. Les deux Queues actives, les 740 événements
Agenda courants et les 3 générations sont conservés; les références fournisseur
de la même œuvre restent dans le catalogue.

Les tables Agenda historiques candidates sont `public_release_event`,
`public_release_generation`, `public_release_generation_event`,
`public_release_active_generation`, `public_release_agenda_lane_state`,
`public_release_agenda_page` et `public_release_current_event`, avec leurs
index dédiés. Elles restent temporairement nécessaires au fallback avant le
premier snapshot R2, à une lane non encore basculée et aux tests de migration.
La suppression ne peut être proposée qu’après un cycle R2 complet, la preuve
que `/v3/releases` lit les deux snapshots actifs, l’absence de tout appel
runtime aux tables et une nouvelle sauvegarde. Le rollback avant suppression
est le Worker précédent ; après suppression, seule une restauration D1
explicitement approuvée ou une migration corrective en avant est sûre.

## Audit des objectifs et parcours A à Z

La [feuille de route](../plans/d1-cost-audit-roadmap.json) décrit les étapes
suivantes ; elle n'autorise pas leur exécution ni les opérations fournisseur.

| Ordre | Résultat attendu | Critère de passage |
|---|---|---|
| A — Référence locale | Ce banc et les tableaux | Mesures reproductibles, limites explicites |
| B — Observabilité et budgets | **Local réalisé** et premier échantillon distant capturé : HTTP et Queue exposent les deltas D1 sans identité | Rapprocher sept jours de logs des métriques natives distantes |
| C — Optimisations justifiées | **Réalisé** : œuvre/clé, projection Agenda différentielle, snapshots et pages bornées | Continuer à surveiller les budgets réels ; aucune purge distante incluse |
| D — Préflight distant | **Réalisé** : quota rétabli, backup, plan frais, migrations et Worker certifiés | Conserver les preuves de version et de rollback |
| E — Déploiement et canari | **Réalisé** : Worker corrigé sous scellé puis route, cron et Queue en dernier | Mesurer le canari réel et fermer sur seuil |
| F — Sept jours et décision économique | **En observation** depuis le 17/09/2026 | Cycle complet, bilan UTC et décision Free/Paid/R2 |
| G — Contrats de tous les fournisseurs | AniList, MangaUpdates, MangaDex, Kitsu Anime et Manga, plus tout adaptateur actif | Recherche, exact lookup, pagination, relations, couvertures, Agenda où disponible ; classification adulte/non-adulte/inconnue et provenance |
| H — Préférences et parcours client | Réception indépendante du réglage d'affichage | OFF masque et bloque actions/notifications ; ON restaure sans nouvelle collecte ; Chrome/Firefox, bibliothèque, recherche, popup, Review, Agenda, WebBridge |
| I/J — Certification et publication extension | Candidate reproductible | Publication séparément approuvée par cible |

L'ordre G/H ne doit pas transformer l'enrichissement serveur en filtre adulte
global : toutes les données autorisées sont reçues indépendamment du choix
local. Le comportement des classifications inconnues et des références liées
doit être décidé puis testé. Aucun paramètre universel « adult » n'est supposé.

### Corrections de gouvernance

- L'ancien objectif GitHub */10 est historique/remplacé : ne pas le réexécuter
  ni le déclarer réussi artificiellement.
- Le déploiement adaptatif ancien conserve ses preuves et son blocage ; la
  reprise contrôlée est l'unique point d'entrée opérationnel.
- L'accès Cloudflare et le quota ont été rétablis le 17/09/2026 ; la version
  corrigée `bfd038ea-4596-49aa-9add-7de77af5056c` sert désormais 100 % du trafic.
  La route, le cron `23 3 * * SUN` UTC et la Queue ont été réactivés dans cet
  ordre ; l'observation économique reste distincte de cette preuve de santé.
- La certification distante reste ouverte : ce banc ne clôt pas l'objectif
  complet de capacité.
- Les étapes adultes nécessitent un périmètre fichiers complet avant validation :
  les six fichiers UI listés historiquement ne suffisent pas à tous les chemins.
- La cadence hebdomadaire doit aussi satisfaire la fraîcheur fonctionnelle :
  changements de planning, reports et nouvelles sorties à tester, pas seulement
  la réduction du coût.
- Le dataflow qualifie désormais le zéro écriture comme un résultat limité au
  hit frais testé et décrit l'admission hebdomadaire par clé, pas une garantie
  universelle par œuvre.

## Limites et audit de fin d'étape

CONFORME pour l'audit local : tests, documentation et Progress ; la reprise
Cloudflare est documentée séparément avec ses preuves distantes. Aucun appel
fournisseur n'a été déclenché par l'échantillon de lecture, et aucun abonnement,
secret, purge, push ou commit n'a été effectué.
AGENTS.md, CLAUDE.md, .codex/hooks.json et les hooks ne sont pas modifiés.
Les modifications utilisateur .codex/config.toml et le workflow non suivi sont
préservés. La compétence stack-audit impose de conserver les preuves manquantes
comme manquantes, sans assimiler tests fonctionnels et validation économique.

MANQUE pour la certification globale : profilage natif complet avec transport
simulé, négatifs et 429/5xx, concurrence D1 réelle, payloads égaux avec ordre JSON
différent, nombre variable d'alias/références, lots de cinquante clés, CPU,
ETag/304/cache navigateur, cycle client complet, couverture de toutes les API,
métriques distantes et observation sept jours.

La vue d’architecture de certification a été ajoutée sans changer de module
produit, contrat, flux runtime, schéma ou dépendance. Aucun nouvel ADR n’est
nécessaire : la vue matérialise les décisions et preuves déjà acceptées sans en
introduire de nouvelle.
Le test monofichier déclenche un avertissement Sensor de taille AST, sans erreur ;
le périmètre approuvé est conservé, sans désactiver de règle.

Validations : 104 tests Worker sur 13 fichiers, TypeScript et tous les workspace
typechecks, documentation, 56 ADR / 502 scopes, `git diff --check`, `npm run
verify`, builds Chrome/Firefox, intégration, npm audit (0 vulnérabilité) et build
Archify réussis. Échantillon distant : `worker.cost` sur une lecture MISS avec
`d1RowsRead=1`, `d1RowsWritten=0`, `providerRequests=0`, HTTP 200. Cette mesure
ponctuelle ne remplace pas l'observation de sept jours.
