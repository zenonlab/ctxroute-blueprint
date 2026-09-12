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

Le runtime partage huit unités de travail par réveil entre deux phases locales.
La phase `inventory` lit et importe des lots de 100 favoris. Son dernier lot
écrit un checkpoint `presence`, jamais un faux état complet. La phase `presence`
reclasse au plus 100 sources par transaction. Chaque page et son curseur sont
écrits dans la même transaction IndexedDB; seule la transaction de la dernière
page écrit `complete`. Une interruption rejoue donc au plus une page de manière
idempotente. Les checkpoints actifs historiques sans phase reprennent comme
`inventory`.

Le runtime demande une continuation immédiate quand une des deux phases reste
active, quand la résolution a consommé la limite de 100 tâches ou quand un appel
fournisseur a épuisé le budget de 20 secondes. Un checkpoint complet reste
stable entre les réveils fournisseurs. L’installation, la mise à jour, le
démarrage du navigateur et une mutation des favoris imposent un nouveau parcours
de l’autorité navigateur. L’action Options reprend une phase active; après
convergence, elle lance volontairement une nouvelle vérification.

Après chaque passage, l’outbox calcule la prochaine tâche exécutable par trois
lectures bornées de ses index composés : READY, RETRY_AT et claim expiré. Le
background matérialise cette échéance par une alarme MV3 ponctuelle nommée à la
date exacte, avec le plancher navigateur de 30 secondes. Il efface l’alarme si
aucune tâche ne reste. Recréer le même nom remplace l’alarme existante et
empêche leur multiplication. L’alarme relance le runtime idempotent depuis les
états IndexedDB puis répare la projection locale. À chaque évaluation du service
worker, le background relit le checkpoint et l’échéance de l’outbox puis restaure
l’alarme nommée. L’alarme périodique des notifications sert de contrôle de
présence : elle réarme cette échéance si le navigateur a perdu l’alarme, sans
lancer elle-même un scan de favoris ni un appel fournisseur.

Le diagnostic global reste `retryable` tant qu’une continuation immédiate ou
une échéance fournisseur existe. Il devient `complete` seulement lorsque
l’inventaire est complet et que la file ne contient plus de travail présent ou
différé.

## Consequences

Une bibliothèque supérieure à 800 favoris converge sur plusieurs réveils sans
garder le service worker vivant. Après sa validation, l’inventaire n’est plus
rescanné pour attendre un fournisseur. Les retries et claims expirés sont repris
à leur propre échéance par lectures indexées bornées. Le contrôle périodique ne
fait que restaurer l’alarme ponctuelle perdue. Options présente les quatre étapes,
la phase courante, la prochaine reprise automatique et une action sûre. Aucun
nouveau stockage, réseau, accès D1 ou permission navigateur n’est ajouté.
