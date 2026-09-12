---
scope:
  - apps/extension/runtime/favorite-resolution-continuation.ts
  - apps/extension/runtime/favorite-resolution-runtime.ts
  - apps/extension/wxt-entrypoints/background.ts
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0041 — Reprise durable de la résolution des favoris

- Status: accepted
- Date: 2026-09-12

## Context

Un réveil MV3 limite volontairement l’inventaire à huit lots de 100 favoris et
la résolution à 100 tâches ou 20 secondes. Le checkpoint restait actif après le
800e favori, mais la fin du réveil était diagnostiquée comme terminée. La seule
reprise périodique était partagée avec les notifications et ne matérialisait pas
le travail restant.

## Decision

Le runtime demande une continuation quand l’inventaire n’a pas atteint son
dernier lot, quand la résolution a consommé la limite de 100 tâches ou quand
un appel fournisseur a épuisé le budget de 20 secondes. Le
background matérialise cette demande par une alarme MV3 ponctuelle nommée,
retardée de 30 secondes. Recréer le même nom remplace l’alarme existante et
empêche leur multiplication. L’alarme relance le même runtime idempotent depuis
le checkpoint IndexedDB puis répare la projection locale.

Le diagnostic global reste `retryable` tant qu’une continuation immédiate est
nécessaire. Un passage qui termine avant ces deux limites après un inventaire
complet devient `complete`; les échéances fournisseur futures restent reprises
par l’alarme périodique existante.

## Consequences

Une bibliothèque supérieure à 800 favoris converge sur plusieurs réveils sans
garder le service worker vivant et sans recommencer le parcours. Une panne de
programmation rend le passage visible comme échoué; l’alarme périodique reste
une voie de reprise. Aucun nouveau stockage, réseau, accès D1 ou permission
navigateur n’est ajouté.
