# Plan maître A à Z de tobirink

Date de référence : 17 septembre 2026.

Statut : architecture cible approuvée et implémentation en cours. Le présent
bloc « Décision » remplace les parcours historiques plus bas lorsqu'ils sont en
contradiction. La certification distante de cette nouvelle version ne pourra
commencer qu'après migration, bascule des lecteurs et déploiement vérifiés.

## Décision

D1 conserve les identités, titres, références et une projection courante de
métadonnées par œuvre canonique. Les alias y pointent sans recopier le profil.
Les demandes temporaires, baux, checkpoints, reprises et douze observations
Agenda maximum par œuvre sont des objets opérationnels R2 conditionnels et
bornés à sept jours, sauf version active et deux versions de reprise.

L'Agenda est virtuel : D1 conserve seulement ancre, intervalle éventuel,
prochaine date annoncée, exceptions, validité et provenance. `/v3/releases`
projette les occurrences à la volée pendant la transition. Une date annoncée
prime, une prévision ne produit que la prochaine occurrence et aucune date ne
fait progresser un compteur confirmé ou la progression privée.

La collecte reste hebdomadaire le dimanche à 03:23 UTC. Une œuvre connue est
rafraîchie par identité canonique; une œuvre terminée n'a plus de collecte
périodique de sorties. Les relations saisons, suites et adaptations ne créent
aucune demande; les références multi-fournisseurs d'une même œuvre sont
conservées pour dédoublonner.

La classification traverse tout le contrat public et local. Un signal adulte
explicite est masqué par défaut; `unknown` reste visible et n'est jamais une
preuve `non-adult`. Aucun service de classification supplémentaire n'est
appelé.

Les étapes obligatoires sont : aligner les preuves, reproduire les budgets,
retirer l'exploration relationnelle, introduire les métadonnées canoniques,
implémenter Agenda/R2, basculer les lecteurs, puis certifier et déployer. Les
anciennes tables ne sont supprimées qu'après sauvegarde, comparaison et
confirmation exacte de leurs cibles.

## État réel

| Élément | État au 17/09/2026 | Ce qui manque |
|---|---|---|
| Correctifs D1 locaux | Terminés et testés; audit lectures/écritures terminé | Deux optimisations de lectures Agenda candidates, non implémentées |
| Migration | `0017–0021` appliquées; aucune migration restante | Observer les compteurs après reprise |
| Worker distant | Version `bfd038ea-4596-49aa-9add-7de77af5056c` à 100 % | Observer la version corrigée et son coût |
| Entrées publiques | `tobirink.com/*` actif; cron `23 3 * * SUN` UTC; `workers_dev=false` | Vérifier la propagation globale du cron sous 15 min |
| Queue | `tobirink-public-discovery` reprise; producteur et consommateur attachés | Rapprocher messages, logs et D1 durant l'observation |
| Quota D1 | Migration distante et déploiement réussis après reset du quota | Mesurer la consommation réelle par jour UTC |
| Coûts | Mesures locales reproductibles et seuils documentés | Observation distante de sept jours |
| Contenus adultes | Contrats cinq fournisseurs, préférence locale et filtrage validés | Conserver la preuve de régression dans le suivi |
| Extension | Aucune publication incluse | Candidate séparée après stabilisation et parcours navigateur |

## Référence historique avant architecture cible

Les sections suivantes conservent la preuve du modèle 0021 pour comparer
l'avant/après. Elles ne décrivent pas la cible et leurs coefficients ne doivent
pas être extrapolés.

## Pourquoi 100 000 écritures restent possibles

Le stock final ne mesure pas les mutations cumulées. Dans l'ancienne fixture,
une œuvre de dix lignes conservées coûte 55 écritures, car le cycle comprend la
demande, le signal, le claim, les états terminaux, la révision, les titres, les
clés et la référence. Les index et les lignes ensuite remplacées ou supprimées
restent comptés dans l'usage du jour même s'ils ne figurent plus dans un dump.

L'ancien Agenda pouvait recommencer un snapshot de 579 événements. À 144 cycles
par jour, les seules insertions représentent 83 376 mutations; le remplacement,
les métadonnées, les checkpoints et les tentatives peuvent dépasser 100 000.
Cette démonstration explique la faisabilité, mais ne prouve pas la composition
exacte de l'incident historique. Les 57 321 événements déclarés ne sont pas un
compteur Cloudflare de lignes écrites.

## Référence mesurée

Mesures locales workerd/D1, migrations jusqu'à 0021, fournisseurs simulés.
Elles ne sont ni une facture ni une mesure distante.

| Parcours | Lignes conservées ou effet | Écritures locales |
|---|---:|---:|
| Première résolution d'une œuvre fixture | 10 lignes catalogue | 55 |
| Même clé `PENDING` ou `VERIFIED` fraîche | aucune ligne utile nouvelle | 0 |
| Nouvelle clé, œuvre déjà connue | demande/cache; aucune nouvelle révision d'œuvre | 19 |
| Refresh de profil sans changement matériel | suivi du cycle | 12 |
| Échec après huit claims | état terminal, hors appels HTTP | 40 |
| Agenda, premier amorçage de 579 événements | projection active + 13 pages | 1 798 |
| Agenda identique après amorçage | aucune nouvelle génération | 70 |
| Agenda avec un événement modifié | diff atomique | 76–77 |

### Audit des répétitions

Les appels D1 ont été relus par chemin d'exécution. Les lectures et écritures
de Discovery sont nécessaires à la déduplication, aux leases, aux collisions
canoniques et aux replays. Le batch de lookup utilise une seule lecture pour
jusqu'à 50 clés. Le Catalogue détail charge work, titres et références en
parallèle car ces projections sont distinctes.

Deux répétitions Agenda restent des optimisations candidates :

- `claimLane` lit l'état pour distinguer `complete`, `deferred` et `resume`,
  puis exécute un `UPDATE ... RETURNING` pour arbitrer le lease ; une requête
  atomique plus riche pourrait réunir ces opérations ;
- `completeLane` relit l'état après le claim afin de comparer `activeDigest` ;
  le claim pourrait transporter cette valeur et supprimer la relecture.

Ces pistes ne sont pas des suppressions à appliquer automatiquement. Elles
doivent préserver reprise, concurrence et `meta.changes`. Aucune autre lecture
ou écriture manifestement inutile n'a été trouvée dans le périmètre audité.

### Projection par utilisateurs et œuvres

`U` utilisateurs et `W` œuvres ne coûtent pas automatiquement zéro écriture.
Si le catalogue et la clé sont déjà chauds, le hit frais testé écrit zéro.
Si chaque œuvre est nouvelle, la fixture donne `55 × U × W`; si tous partagent
les mêmes œuvres et clés, elle donne `55 × W` une seule fois.

| Utilisateurs | Œuvres chacun | Catalogue entièrement partagé | Catalogues entièrement distincts |
|---:|---:|---:|---:|
| 1 | 20 | 1 100 | 1 100 |
| 100 | 20 | 1 100 | 110 000 |
| 1 000 | 20 | 1 100 | 1 100 000 |
| 10 000 | 20 | 1 100 | 11 000 000 |

Ce tableau est une borne illustrative de créations froides, pas une prévision
d'audience. Les alias, références, relations, retries et clés distinctes changent
le résultat. Le tableau exhaustif se trouve dans
[l'audit D1](./d1-cost-audit.md).

## Budgets et seuils proposés

Ces seuils doivent être approuvés avec le canari; ils ne sont pas encore une
politique de production.

| Indicateur | Référence locale | Alerte/arrêt proposé |
|---|---:|---:|
| Écritures D1 du jour UTC | Free : limite officielle 100 000 | alerte 20 000; recoupure 50 000 |
| Premier amorçage Agenda | 1 798 | recoupure au-delà de 10 000 |
| Agenda inchangé ou diff minime | 70 / 76–77 | recoupure au-delà de 500 par cycle post-amorçage |
| Discovery, hit frais ou même clé dupliquée | 0 | toute écriture ferme le canari |
| Discovery, nouvelle clé d'une œuvre connue | 19 | recoupure au-delà de 30 |
| Discovery, première œuvre comparable | 55 | recoupure au-delà de 100 |
| Retry par entité | maximum fonctionnel 8 | aucun neuvième traitement applicatif |

Une fermeture signifie : suspendre la Queue, retirer schedules et route, garder
les données, recueillir les compteurs et ne pas réessayer à l'aveugle.

## Parcours A à Z

### A — Référence locale — terminé

- Mesurer Discovery et Agenda sur migrations réelles et fixtures synthétiques.
- Corriger l'Agenda par projection active différentielle.
- Éviter la révision et la réécriture d'une œuvre déjà connue sous une autre clé.
- Exposer `D1Result.meta` dans `worker.cost` sans identité ni payload.
- Auditer le taux de répétition et l'utilité des lectures/écritures D1 par
  chemin, avec les deux pistes Agenda conservées comme candidates.

Preuves attendues déjà obtenues : Worker 103/103, adaptateur D1 20/20,
typechecks, anti-slop, ADR, documentation et dataflow ciblé.

### B — Certifier la release locale

- Relire le diff et les hooks sans modifier les changements de l'utilisateur.
- Valider tous les tests, builds, contrats, ADR, documentation et diagrammes.
- Exécuter les campagnes manquantes : concurrence D1, batch de 50, alias et
  références variables, négatifs/429/5xx, reprises et égalité JSON.
- Geler le candidat et ses hashes; aucun appel fournisseur réel.

Passage : tous les gates sont verts ou chaque lacune est explicitement acceptée.

### C — Versionner et publier le candidat

- Proposer un commit unique `perf(d1): bound catalogue and agenda writes`.
- Obtenir l'approbation distincte du commit si elle n'est pas déjà couverte.
- Obtenir ensuite l'approbation distincte du push.
- Vérifier que `origin/main` pointe exactement sur le SHA certifié.

Passage : dépôt propre hors `.codex/config.toml`, SHA distant exact, CI observée.

### D — Préflight distant sous scellé

- Inspecter compte, D1, Worker, routes, schedules, sous-domaine et Queue.
- Vérifier `routes=[]`, `crons=[]`, `workers_dev=false` et Queue suspendue.
- Confirmer la disponibilité d'écriture; ne pas déduire cela d'un `SELECT`.
- Exporter un backup D1 frais, non vide, ignoré par Git, avec SHA-256 et contrôle
  d'intégrité.
- Générer un nouveau plan hashé, limité à D1 `tobirink-public` et Worker
  `tobirink-public-api`; les plans expirés ne sont jamais réutilisés.

Passage : backup restaurable, migrations `0017–0021` seules en attente, SHA du
Worker certifié, scellé prouvé et plan relu. Toute mutation exige une approbation
fournisseur exacte.

### E — Migrer et déployer sans trafic

- Appliquer `0017–0021`, puis le Worker corrigé, sous scellé.
- Vérifier migrations, version 100 %, projection et invariants sans lire de
  payload privé ni appeler un fournisseur.
- Ne supprimer ni staging, ni historique, ni message.

Passage : aucun échec, aucune migration en attente, routes/crons toujours vides,
Queue toujours suspendue.

Rollback : garder le scellé et produire un correctif avant. Après une publication
0021, l'ancien Worker peut servir une projection historique devenue obsolète;
ne pas le restaurer aveuglément. Une restauration D1 depuis le backup est une
opération destructive séparée qui exige une décision et une approbation exactes.

### F — Réactiver par canari

Chaque ligne est une mutation fournisseur distincte et réversible :

1. Restaurer uniquement `tobirink.com/*`, puis vérifier les lectures HTTP.
2. Restaurer uniquement le cron `23 3 * * SUN`, puis vérifier l'inventaire.
3. Reprendre la Queue en dernier.
4. Exécuter un canari borné et rapprocher `worker.cost` des métriques D1.

Au premier seuil dépassé, fermer Queue, cron et route dans cet ordre de sécurité.

### G — Observer sept jours et décider Free/Paid/R2

- Couvrir au moins un cycle hebdomadaire complet, un cycle inchangé, un changement
  réel et une panne de lane sans perte du dernier snapshot valide.
- Reporter par jour UTC les écritures/lectures D1, requêtes et CPU Worker,
  messages Queue, opérations/stockage R2 et appels gateway.
- Expliquer les écarts entre somme des `D1Result.meta` et métriques Cloudflare.
- Choisir Free si pic et marge restent sous les seuils acceptés.
- Proposer Workers Paid seulement si la disponibilité ou les pics le justifient;
  le prix de base est 5 USD/mois, pas 5 EUR TTC garantis.
- Évaluer R2 uniquement comme complément/snapshot après benchmark.

Passage : sept jours sans boucle, budget mensuel documenté et décision signée.

### H — Auditer les contenus adultes de toutes les API

Inventorier les adaptateurs et tous leurs chemins actifs avant de coder. Le
périmètre connu comprend AniList, MangaUpdates, MangaDex, Kitsu Anime et Kitsu
Manga; tout fournisseur ajouté entre aussi dans cette règle.

Pour chaque API, vérifier dans sa documentation officielle : recherche, lookup
exact, pagination, relations, couvertures, paramètres ou catégories adultes,
valeurs par défaut, restrictions d'âge et support Agenda. Il n'existe pas de
paramètre adulte universel.

Le serveur collecte et transmet tout contenu autorisé par chaque fournisseur,
indépendamment de la préférence d'affichage locale. Il conserve une classe
`adult`, `non-adult` ou `unknown` avec sa provenance. La politique `unknown`
doit être décidée explicitement avant implémentation.

### I — Ajouter la préférence locale

- Option persistante, désactivée par défaut.
- `OFF` masque titres, jaquettes et entrées adultes dans bibliothèque, recherche,
  Review, popup, relations, Agenda et WebBridge.
- `OFF` bloque aussi commandes, navigation indirecte, anciens liens, actions et
  notifications concernant une œuvre masquée.
- `OFF` ne supprime jamais catalogue, favoris, progression ou cache et ne relance
  aucun fournisseur.
- `ON` réaffiche les données déjà reçues.
- Tester `adult`, `non-adult`, `unknown`, redémarrage, bascule, hors-ligne,
  Chrome et Firefox pour chaque adaptateur concerné.

Passage : aucune fuite visuelle ou action indirecte lorsque `OFF`, aucune perte
de données, aucune nouvelle télémétrie personnelle.

### J — Publier l'extension séparément

Créer et certifier une nouvelle candidate reproductible, vérifier manifestes,
permissions, hashes et parcours navigateur. Commit, push, upload R2, publication
Chrome et publication Firefox restent des opérations séparément approuvées.

## Frontières d'approbation

| Action | Incluse dans le présent plan |
|---|---|
| Inspection, tests et documentation locale | oui |
| Commit | oui dans chaque étape autonome matérialisée et vérifiée |
| Push | oui après les gates locales et revue de la branche |
| Backup distant | lecture/export à annoncer dans son étape; aucune restauration |
| Migration D1 ou déploiement Worker | oui après inspect/plan/apply et preuve locale |
| Route, cron ou reprise Queue | oui après inventaire et plan exact |
| Workers Paid ou tout coût | non |
| Purge/suppression/restauration | non |
| Publication d'extension | non |

## Preuves de clôture

La reprise n'est complète que lorsque les preuves suivantes sont enregistrées :

- SHA local, SHA `origin/main` et version Worker identiques;
- backup frais avec taille, hash et intégrité;
- migrations `0017–0021` appliquées, aucune restante;
- état distant des routes, cron, `workers.dev` et Queue avant/après chaque gate;
- résultats du canari et compteurs D1 par opération;
- rapport UTC de sept jours et décision Free/Paid/R2;
- audit officiel par API et tests complets de la préférence adulte;
- documentation, ADR, Progress et Archify cohérents;
- aucun secret, payload, titre, identifiant utilisateur ou donnée privée dans les
  logs de coût.

## Sources internes

- [Audit détaillé D1](./d1-cost-audit.md)
- [Runbook Cloudflare](./cloudflare.md)
- [Feuille de route machine](../plans/d1-cost-audit-roadmap.json)
- [Continuation sous barrières](../plans/adaptive-public-refresh-safe-continuation.json)
- [ADR des budgets D1](../decisions/ADR-0055-d1-write-amplification-budgets.md)
