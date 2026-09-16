# Plan maître A à Z de tobirink

Date de référence : 16 septembre 2026.

Statut : correction locale certifiée; aucune reprise Cloudflare, souscription,
publication, suppression, migration distante, route, cron, Queue, push ou commit
n'est autorisé par ce document.

## Décision

Conserver D1 comme base relationnelle du catalogue et de l'Agenda.
Conserver R2 pour les objets, images et sauvegardes; ne pas l'utiliser comme
remplacement automatique de D1.
Rester sur l'offre Free pendant la certification si le reset quotidien et la
marge observée le permettent. Workers Paid est une décision de coût séparée,
utile pour une reprise immédiate ou une marge opérationnelle, jamais un correctif
à l'amplification d'écritures.

Le parcours opérationnel unique est `goal-controlled-d1-service-resumption`.
Les anciens objectifs de déploiement et le collecteur GitHub sont des preuves
historiques : ils ne doivent pas être relancés.

## État réel

| Élément | État au 16/09/2026 | Ce qui manque |
|---|---|---|
| Correctifs D1 locaux | Terminés et testés | Commit, push et certification distante séparés |
| Migration | `0021_agenda_active_projection.sql` locale; `0017–0021` distantes en attente à la dernière inspection | Backup frais puis plan Cloudflare frais |
| Worker distant | Ancienne version `2267a691` à 100 % lors de l'inspection de 17:15 UTC | Déployer le SHA certifié sous scellé |
| Entrées publiques | Configuration locale `routes=[]`, `crons=[]`, `workers_dev=false` | Recertifier routes, schedules et sous-domaine à distance |
| Queue | Preuve historique de pause, état courant non établi | Recertifier `delivery_paused`; reprise en dernier |
| Quota D1 | Une lecture authentifiée a réussi | Prouver une écriture disponible sans boucle ni retry |
| Coûts | Mesures locales reproductibles | Métriques D1 distantes et observation de sept jours |
| Contenus adultes | Objectif défini, pas implémenté | Audit officiel par API, modèle, UI, actions et tests |
| Extension | Aucune publication incluse | Candidate séparée après stabilisation et parcours navigateur |

## Pourquoi 100 000 écritures restent possibles

Le stock final ne mesure pas les mutations cumulées. Une œuvre de dix lignes
conservées coûte 55 écritures dans la fixture locale, car le cycle comprend la
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
2. Restaurer uniquement le cron `23 3 * * 0`, puis vérifier l'inventaire.
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
| Commit | non, sauf étape bornée l'incluant explicitement |
| Push | non |
| Backup distant | lecture/export à annoncer dans son étape; aucune restauration |
| Migration D1 ou déploiement Worker | non |
| Route, cron ou reprise Queue | non, chacune séparément |
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
