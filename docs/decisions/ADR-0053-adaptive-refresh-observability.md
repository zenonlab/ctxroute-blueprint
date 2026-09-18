---
scope:
  - apps/worker/src/diagnostics.ts
  - apps/worker/src/diagnostics.test.ts
  - apps/worker/src/operational-metrics.ts
  - apps/worker/src/operational-metrics.test.ts
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/native-collectors.test.ts
  - apps/worker/src/catalogue/public-discovery-routes.ts
  - apps/worker/src/catalogue/public-discovery-routes.test.ts
  - docs/operations/cloudflare.md
  - docs/architecture/src/agenda-release.dataflow.json
  - docs/architecture/src/public-discovery.dataflow.json
  - docs/architecture/src/adaptive-public-refresh.dataflow.json
  - docs/architecture/src/adaptive-public-refresh.architecture.json
  - docs/architecture/src/public-pipeline.architecture.json
review: on-change
revised: true
---

# ADR-0053 — Mesurer le rafraîchissement adaptatif sans identité

- Status: accepted
- Date: 2026-09-16

## Contexte

Les budgets Agenda, Discovery et réhydratation doivent être vérifiables en
requêtes HTTP réelles et en lignes D1. Persister ces compteurs dans D1 ferait
cependant d’une lecture publique ordinaire une écriture et augmenterait la
charge que la mesure cherche à contrôler.

## Décision

Émettre un événement applicatif `worker.cost` à schéma fermé pour chaque
traitement Queue, comme le diagnostic de disposition de l’ADR-0052. Les
événements de lecture et d’admission HTTP restent soumis au verrou
`TOBIRINK_WORKER_DIAGNOSTICS=worker-v1`. Un événement de traitement
contient uniquement la tâche, un fournisseur borné ou `mixed`, les requêtes et
pages HTTP, les résultats acceptés, l’issue `changed`, `unchanged`,
`deduplicated`, `backoff` ou `failed`, la durée bornée, les retries et les
lignes D1 lues ou écrites. Les admissions et lectures publiques ajoutent
seulement leurs compteurs agrégés de HIT, MISS, déduplication ou réhydratation.

Compter les appels au point où le transport reçoit l’URL fournisseur, avant la
sélection du chemin direct ou gateway. Pour Agenda, incrémenter séparément
`pagesRequested` à chaque page effectivement demandée; Discovery publie zéro
page tant qu’il n’expose pas de pagination. Ne jamais dériver un compteur de
l’autre. Compter D1 uniquement depuis
`D1Result.meta.rows_read` et `rows_written`; l’adaptateur d’observation délègue
la requête originale et n’inspecte ni SQL lié, ni paramètres, ni résultats.

Construire les compteurs journaliers dans Cloudflare Logs en sommant les champs
de `worker.cost`. Ne créer ni table D1, ni Analytics Engine, ni identifiant de
cardinalité. Les événements excluent titre, empreinte, référence d’œuvre, URL,
IP, payload fournisseur, secret et identifiant d’installation.

## Conséquences

Les coûts sont comparables aux métriques natives D1 et aux quotas HTTP sans
écriture sur cache hit. La panne ou la désactivation du diagnostic ne change
aucun résultat produit. Les journaux ne permettent pas de reconstituer une
bibliothèque ni une œuvre demandée; ils permettent seulement des sommes
quotidiennes par tâche, fournisseur et issue.
