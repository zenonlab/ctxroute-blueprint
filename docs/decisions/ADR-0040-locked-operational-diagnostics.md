---
scope:
  - apps/worker/**
  - apps/extension/runtime/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/options/ResolutionStatus/**
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0040 — Diagnostics opérationnels verrouillés

- Status: accepted
- Date: 2026-09-12

## Context

La file de résolution MV3 peut s'interrompre sans que l'état local permette de
distinguer une absence d'inventaire, une reprise, une erreur interne ou une
réponse Worker. Le diagnostic ne doit jamais créer une nouvelle copie des
données privées des favoris.

## Decision

Le Worker émet des événements JSON versionnés uniquement lorsque la variable
non secrète `TOBIRINK_WORKER_DIAGNOSTICS` vaut exactement `worker-v1`. Chaque
événement contient une famille de route fermée, la méthode réduite, le statut,
une durée bornée et un identifiant de corrélation aléatoire. Le chemin, les
paramètres, les en-têtes, les corps et les erreurs brutes sont exclus.

L'extension conserve au plus 100 événements versionnés dans `storage.local`
uniquement lorsque `tobirink.extensionDiagnostics` vaut exactement
`extension-v1`. Les événements décrivent les phases d'inventaire et de
résolution, leurs compteurs bornés et un code d'échec fermé. Ils ne contiennent
ni titre, ni URL, ni dossier, ni progression, ni identifiant fournisseur, ni
secret. La page Options de confiance lit l'état et active ou désactive le
verrou. Ces événements restent locaux et sont exclus de `storage.sync`, des
exports, de WebBridge et du Worker.

Les logs de requête natifs de Cloudflare suivent la configuration de la
plateforme; le verrou Worker gouverne les événements applicatifs Tobirink.

## Consequences

Une exécution peut être corrélée entre son statut HTTP et une famille de route
sans exposer le contenu traité. La valeur `off`, une valeur absente ou toute
valeur inconnue désactive le mécanisme. La taille locale reste bornée et une
panne du diagnostic ne bloque jamais la résolution.
