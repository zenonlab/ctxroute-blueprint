---
scope:
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/options/ResolutionStatus/**
  - apps/extension/runtime/resolution-status-messages.ts
  - apps/extension/runtime/favorite-resolution-continuation.ts
  - apps/extension/runtime/favorite-resolution-runtime.ts
  - apps/worker/src/index.ts
  - apps/worker/wrangler.jsonc
  - apps/extension/runtime/use-resolution-status.ts
  - packages/application/src/favorites/public-discovery-resolution.ts
  - packages/application/src/favorites/favorite-resolution-runner.ts
  - packages/application/src/use-cases/import-favorite-sources.ts
  - packages/application/src/public-discovery/public-discovery-contract.ts
  - packages/adapters-browser/src/catalogue/http-public-discovery-adapter.ts
  - docs/architecture/src/real-favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0061 — Reprise explicite des demandes Public Discovery épuisées

Date : 2026-09-22

Révisé : 2026-09-23

Statut : accepté

## Contexte

Le profil réel a montré des lignes `RETRYABLE/PROVIDER_UNAVAILABLE` correspondant à des demandes Public Discovery déjà arrivées à `FAILED/ATTEMPT_LIMIT`. Une reprise automatique depuis chaque lecture de statut pourrait réactiver une charge fournisseur sans contrôle et masquer la frontière entre attente, échec transitoire et mutation de production.

## Décision

L’extension expose une action utilisateur explicite, visible uniquement lorsqu’un compteur `providerPaused` est présent. Cette action :

- lit les `FavoriteSource` observés et leurs artefacts privés ;
- reconstruit la clé et la requête canoniques avec le même code que la résolution normale et sa prélecture groupée, y compris la référence exacte ou l’indice synchronisé unique compatible ;
- envoie le payload Public Discovery v3 exact via une méthode `requestRecovery` dédiée ;
- traite les éléments un par un avec la cadence d’admission bornée ;
- isole les erreurs par élément afin qu’un favori défectueux ne bloque pas le lot ;
- limite chaque reprise à 15 secondes et dix soumissions, avance le curseur après chaque réponse interprétée et persiste l’échéance des erreurs transitoires ;
- enregistre la source en cours avant HTTP ; après interruption, lit son état plutôt que réarmer aveuglément un nouvel échec ;
- restaure l’alarme à chaque démarrage du service worker, du navigateur et après pause ; respecte l’échéance même lors d’une nouvelle action humaine ;
- refuse deux reprises simultanées et sérialise reprise et runner normal qui partagent le même adaptateur HTTP ;
- transmet les réponses `PENDING` au travail durable normal à leur échéance, sans nouvelle file ; les états terminaux seront interprétés par ce même runner ;
- relance ensuite la réconciliation ; seules l’action humaine, l’installation, la restauration et l’audit périodique réparent globalement la projection.

La lecture de statut et les reprises automatiques ne réarment jamais `FAILED` : seule l’action explicite initie un lot fini. Une réponse `UNAVAILABLE` persistante termine l’élément de ce lot mais conserve sa raison visible et son action humaine. Sa simple lecture normale ne consomme aucun essai local et est reportée de quinze minutes. Les anciennes limites d’essai locales ne sont pas requalifiées arbitrairement comme des pannes fournisseur. Une erreur permanente de contrat ou interne est enregistrée sur sa source et n’empêche pas le traitement des suivantes. La fin du lot supprime réellement la clé de curseur et l’alarme ; une alarme tardive sans curseur n’initie jamais un nouveau lot.

Un réveil Worker séparé, borné à cinq claims et déclenché quotidiennement à 03:37 UTC, traite les demandes D1 échues lorsqu’un signal Queue a été perdu ; le cron Agenda hebdomadaire est inchangé. Aucun SQL manuel ni endpoint caché n’est ajouté. Le run canari et la reprise historique restent soumis au flux de production protégé et à une confirmation immédiate avant mutation distante.

## Conséquences

La récupération est observable et réversible au niveau applicatif : désactiver le contrôle empêche toute nouvelle action, sans supprimer ni réécrire les données existantes. Une reprise de centaines d’entrées prend volontairement du temps afin de respecter la cadence publique ; les réponses `PENDING` restent dans la file et sont réconciliées ultérieurement.

## Validation

- typecheck extension ;
- régression reproduite avec le véritable `HttpPublicDiscoveryAdapter` : receiver préservé et requête HTTP réellement transmise ;
- tests des clés et payloads communs, des indices synchronisés et de la prélecture groupée ;
- tests reprise avec vrai adaptateur HTTP et stockage de contrat : dix demandes, quinze secondes, redémarrage, pause, `Retry-After`, erreur permanente, lecture après interruption, fin de lot et `UNAVAILABLE` sans boucle ;
- test du rendu UI ;
- aucune récupération distante exécutée pendant cette modification.
