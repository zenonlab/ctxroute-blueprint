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

Le runtime demande une continuation immédiate quand l’inventaire n’a pas
atteint son dernier lot, quand la résolution a consommé la limite de 100 tâches
ou quand un appel fournisseur a épuisé le budget de 20 secondes. Un checkpoint
d’inventaire complet reste stable entre les réveils fournisseurs. Seuls le
démarrage du navigateur, une mutation des favoris et l’action manuelle imposent
un nouveau parcours de l’autorité navigateur.

Après chaque passage, l’outbox calcule la prochaine tâche exécutable par trois
lectures bornées de ses index composés : READY, RETRY_AT et claim expiré. Le
background matérialise cette échéance par une alarme MV3 ponctuelle nommée à la
date exacte, avec le plancher navigateur de 30 secondes. Il efface l’alarme si
aucune tâche ne reste. Recréer le même nom remplace l’alarme existante et
empêche leur multiplication. L’alarme relance le runtime idempotent depuis les
états IndexedDB puis répare la projection locale.

Le diagnostic global reste `retryable` tant qu’une continuation immédiate ou
une échéance fournisseur existe. Il devient `complete` seulement lorsque
l’inventaire est complet et que la file ne contient plus de travail présent ou
différé.

## Consequences

Une bibliothèque supérieure à 800 favoris converge sur plusieurs réveils sans
garder le service worker vivant. Après sa validation, l’inventaire n’est plus
rescanné pour attendre un fournisseur. Les retries et claims expirés sont repris
à leur propre échéance sans boucle périodique ni scan de l’outbox. Une panne de
programmation rend le passage visible comme échoué; l’alarme périodique reste
une voie de reprise. Aucun nouveau stockage, réseau, accès D1 ou permission
navigateur n’est ajouté.
