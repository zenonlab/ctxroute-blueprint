---
scope:
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/native-collectors.test.ts
  - apps/provider-gateway/src/index.ts
  - apps/provider-gateway/src/index.test.ts
  - apps/worker/wrangler.jsonc
  - docs/operations/cloudflare.md
  - docs/architecture/src/public-pipeline.architecture.json
  - docs/architecture/src/agenda-release.dataflow.json
review: on-change
revised: true
---

# ADR-0052 — Observabilité bornée des collecteurs natifs

- Status: accepted
- Date: 2026-09-15

## Contexte

Le consumer Queue conservait correctement la dernière génération Agenda saine,
mais réduisait toute défaillance de lane à `agenda-collection-incomplete`.
Après huit retries, Cloudflare transfère le message vers la DLQ configurée;
les logs ne distinguaient ni le fournisseur fautif, ni une réussite, ni le
neuvième livraison. La health check Deno utilisait aussi la forme d’erreur pour
annoncer un succès.

## Décision

Émettre pour chaque décision Queue un objet JSON borné contenant seulement le
type de signal, le numéro de tentative, la disposition et, en échec, un code
classifié ainsi que le délai. Les seules dispositions sont `ack-success`,
`ack-invalid`, `retry` et `retry-to-dlq`. Aucun payload, titre, identifiant,
URL ou corps fournisseur ne peut entrer dans ce diagnostic.

Réduire les échecs Agenda aux lanes `anilist`, `mangaupdates`, à leur forme
combinée ou à `provider` lorsque la lane n’est pas reconnue. Le détail amont
reste interne au collecteur portable et n’est pas propagé au journal Worker.

Conserver la Queue principale à huit retries et la DLQ sans consumer. Cette
étape rend le transfert imminent observable mais ne consomme, ne rejoue et ne
purge jamais automatiquement la DLQ. Une opération sur son contenu reste une
mutation fournisseur approuvée séparément.

Séparer enfin la réponse de succès Deno de la forme d’erreur : `/healthz`
retourne `{ "status": "healthy" }`, tandis qu’une gateway non configurée reste
fermée en 503 avec un code d’erreur. Le démarrage HTTP ne doit pas attendre
`Deno.openKv()` : la santé sert le warm-up immédiatement et une requête signée
sans KV disponible reçoit le 503 borné.

Compléter la décision de Queue par l’événement de coût fermé de l’ADR-0053.
La disposition explique le contrôle de livraison; `worker.cost` mesure la tâche
une seule fois avec appels HTTP réels, résultats acceptés, issue, durée,
retries et métriques D1. Aucun des deux événements ne porte de contenu métier.

## Conséquences

Une panne AniList ou MangaUpdates devient identifiable sans exposer de donnée
fournisseur. Le dernier succès D1 reste l’unique génération servie en cas
d’échec. L’opérateur possède un signal structuré avant la DLQ, mais une alerte
distante ou un replay exige toujours une opération fournisseur dédiée.

Sources consultées le 15 septembre 2026 :

- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- https://developers.cloudflare.com/queues/configuration/dead-letter-queues/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
