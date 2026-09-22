---
scope:
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/options/ResolutionStatus/**
  - apps/extension/runtime/resolution-status-messages.ts
  - apps/extension/runtime/favorite-resolution-continuation.ts
  - apps/worker/src/index.ts
  - apps/worker/wrangler.jsonc
  - apps/extension/runtime/use-resolution-status.ts
  - packages/application/src/favorites/public-discovery-resolution.ts
  - packages/application/src/public-discovery/public-discovery-contract.ts
  - packages/adapters-browser/src/catalogue/http-public-discovery-adapter.ts
  - docs/architecture/src/real-favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0061 — Reprise explicite des demandes Public Discovery épuisées

Date : 2026-09-22

Statut : accepté

## Contexte

Le profil réel a montré des lignes `RETRYABLE/PROVIDER_UNAVAILABLE` correspondant à des demandes Public Discovery déjà arrivées à `FAILED/ATTEMPT_LIMIT`. Une reprise automatique depuis chaque lecture de statut pourrait réactiver une charge fournisseur sans contrôle et masquer la frontière entre attente, échec transitoire et mutation de production.

## Décision

L’extension expose une action utilisateur explicite, visible uniquement lorsqu’un compteur `providerPaused` est présent. Cette action :

- lit les `FavoriteSource` observés et leurs artefacts privés ;
- reconstruit la clé et la requête canoniques avec le même code que la résolution normale ;
- envoie le payload Public Discovery v3 exact via une méthode `requestRecovery` dédiée ;
- traite les éléments un par un avec la cadence d’admission bornée ;
- isole les erreurs par élément afin qu’un favori défectueux ne bloque pas le lot ;
- limite chaque réveil à 15 secondes et dix soumissions, avance le curseur seulement après une réponse interprétée et persiste l’échéance des erreurs transitoires ;
- restaure l’alarme à chaque démarrage du service worker et refuse deux reprises simultanées ;
- relance ensuite la réconciliation et la projection locale.

La lecture de statut et les reprises automatiques ne réarment jamais `FAILED` : seule l’action explicite initie un lot fini. Un réveil Worker séparé, borné à cinq claims et déclenché toutes les quinze minutes, traite les demandes D1 échues lorsqu’un signal Queue a été perdu ; le cron Agenda hebdomadaire est inchangé. Aucun SQL manuel ni endpoint caché n’est ajouté. Le run canari et la reprise historique restent soumis au flux de production protégé et à une confirmation immédiate avant mutation distante.

## Conséquences

La récupération est observable et réversible au niveau applicatif : désactiver le contrôle empêche toute nouvelle action, sans supprimer ni réécrire les données existantes. Une reprise de centaines d’entrées prend volontairement du temps afin de respecter la cadence publique ; les réponses `PENDING` restent dans la file et sont réconciliées ultérieurement.

## Validation

- typecheck extension ;
- test du payload de récupération et de la cadence de l’adaptateur ;
- test du rendu UI ;
- aucune récupération distante exécutée pendant cette modification.
