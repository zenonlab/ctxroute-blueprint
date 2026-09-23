---
scope:
  - packages/adapters-cloudflare/src/catalogue/d1-public-discovery-v3-adapter.ts
  - apps/worker/src/catalogue/public-discovery-routes.ts
  - apps/worker/src/catalogue/public-discovery-routes.test.ts
  - docs/architecture/src/favorite-convergence.architecture.json
  - .project/project-config.json
  - docs/audits/favorite-convergence-20260923.md
review: on-change
revised: true
---

# ADR-0062 — Regrouper les lookup Discovery bornés

- Status: accepted
- Date: 2026-09-23

## Contexte

Le contrat autorise au plus 50 clés dans un lookup public. L’implémentation
lisait auparavant chaque clé séparément, ce qui pouvait consommer 100 à 150
appels D1 pour une seule requête HTTP et dépasser la limite gratuite par
invocation. Les routes de lecture étaient aussi publiques sans limite IP,
contrairement aux admissions et aux refreshes.

## Décision

`D1PublicDiscoveryV3Adapter.readMany` utilise une seule requête préparée avec
`json_each` et une jointure sur les quatre colonnes d’identité. Les transitions
terminales expirées restent traitées individuellement seulement lorsqu’une
ligne effectivement retournée atteint la borne d’essais. Les clés absentes
restent des `MISS` et l’ordre de la réponse suit l’entrée validée. Les routes
`GET` et `lookup` réutilisent le limiteur Cloudflare avec une clé préfixée
`read:<ip>`, séparée du budget admission/refresh, avant toute lecture D1.

## Conséquences

Un lookup de 50 clés reste borné à une lecture D1 normale, sans affaiblir les
gardes d’identité ni les transitions `FAILED`. Une base sans JSON1 doit échouer
fermée pendant la validation, jamais revenir silencieusement au N+1. Un client
partageant une IP dispose d’au plus 60 lectures par minute (jusqu’à 3 000 clés
par minute via les lots de 50), tandis que les admissions conservent leur propre
budget. Un `429` est retourné avant le parsing et avant toute opération D1.
