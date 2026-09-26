---
scope:
  - packages/public-discovery/src/**
review: on-change
---

# ADR-0063 — Résoudre les sources TypeScript du build Web

- Status: accepted
- Date: 2026-09-26

## Contexte

Le package privé Public Discovery est consommé directement depuis ses sources
par les workspaces. Ses imports relatifs terminés par `.js` sont acceptés par
TypeScript et Vitest, mais Next.js 16 avec Turbopack ne les résout pas vers les
sources `.ts` dans un checkout frais.

## Décision

Les imports relatifs de production du package omettent l'extension. Cette
forme est résolue nativement par le mode `Bundler` de TypeScript, Vitest et
Next. Aucun import externe, contrat public ou comportement métier n'est
modifié.

## Conséquences

La CI construit le Web depuis les seules sources versionnées sans dépendre
d'artefacts locaux. La sortie `tsc` reste un artefact de validation interne;
le package privé est exécuté après bundling par ses consommateurs.
