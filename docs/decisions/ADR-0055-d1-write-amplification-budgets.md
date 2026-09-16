---
scope:
  - apps/worker/migrations/0021_agenda_active_projection.sql
  - apps/worker/src/composition.ts
  - apps/worker/src/operational-metrics.ts
  - apps/worker/src/catalogue/public-discovery-routes.ts
  - apps/worker/src/releases/public-release-calendar.ts
  - apps/worker/src/releases/public-release-collectors.ts
  - packages/adapters-cloudflare/src/catalogue/d1-public-discovery-v3-adapter.ts
  - docs/02-quality-strategy.md
  - docs/operations/cloudflare.md
  - docs/operations/d1-cost-audit.md
  - docs/architecture/src/adaptive-public-refresh.dataflow.json
review: on-change
---

# ADR-0055 — Borner l’amplification des écritures D1

- Status: accepted
- Date: 2026-09-16

## Contexte

La détection de changement de l’Agenda évitait une génération identique, mais
le moindre changement réinsérait les 579 événements de la fixture. Le banc D1
local mesurait 1 798 écritures par génération modifiée et 2 378 lors de la
rétention. Les pages terminées n’étaient jamais supprimées. Discovery publiait
également une nouvelle révision catalogue lorsqu’une autre clé résolvait une
œuvre déjà matériellement identique. Enfin, les diagnostics HTTP annonçaient
HIT/MISS sans leurs compteurs `D1Result.meta`.

## Décision

La migration additive 0021 crée `public_release_current_event`, projection
active indexée par `(occurrence_value, id)`. Une publication modifiée utilise
un seul `db.batch()` D1 : elle conserve un instantané JSON borné à 1,8 Mo dans
la génération, insère ou met à jour seulement les événements matériellement
différents, retire les identités absentes, puis déplace atomiquement le pointeur
actif. Les horodatages d’observation seuls ne rendent pas un événement
matériellement différent. La génération active et les deux générations
précédentes gardent leur instantané restaurable.

Les pages Agenda terminées sont conservées seulement lorsqu’elles sont le
snapshot actif d’une lane ou la collecte interrompue actuellement reprenable.
La table historique `public_release_generation_event` reste compatible avec
les migrations antérieures, mais les nouvelles générations n’y dupliquent plus
chaque événement.

Avant une publication Discovery, comparer la fiche, les titres, les clés
canoniques, les références et les relations proposées au catalogue courant.
Une nouvelle clé qui résout exactement la même œuvre termine sa demande sans
réécrire la révision ni la fiche catalogue. Les états, baux, nonces et preuves
de demande restent écrits : cette optimisation ne confond pas clé et œuvre.

Composer les adaptateurs HTTP avec un seul observateur D1 par requête. Les
événements `worker.cost` des routes Discovery incluent le delta exact
`rows_read`/`rows_written`, sans SQL, paramètre, résultat ou identité.

## Conséquences

Dans la fixture locale de 579 événements, un cycle à un seul changement coûte
76–77 écritures après amorçage, contre 1 798–2 378 auparavant. Treize pages
restent après cinq cycles au lieu de 65. Une première réconciliation peut
encore être coûteuse et doit être budgétée séparément.

D1 reste le moteur relationnel actif ; R2 n’est pas requis par cette correction.
Le plafond Free demeure journalier : les budgets sont des tests de régression,
pas une garantie de capacité distante. Migration, déploiement, réactivation de
Queue ou Cron, purge historique et changement de forfait restent des opérations
Cloudflare séparément planifiées et approuvées.
