---
scope:
  - package.json
  - package-lock.json
  - apps/*/package.json
  - packages/*/package.json
  - .github/workflows/validate.yml
review: on-change
---

# ADR-0048 — Baseline d’outillage commune aux workspaces

- Status: accepted
- Date: 2026-09-15

## Contexte

Des workspaces déclaraient simultanément TypeScript 7.0.2 et 5.9.3, ainsi que
deux correctifs différents de `@types/node` 24.10. npm install hissait alors
des versions incompatibles avec les contraintes déclarées : les validations
fonctionnelles passaient, mais `npm ls` signalait un arbre invalide.

La CI générale n’exécutait que `npm run validate`. Elle ne prouvait donc ni
l’intégrité de l’arbre npm, ni le gate complet sur l’environnement Linux de
référence.

## Décision

Le manifeste racine fournit TypeScript `7.0.2` aux scripts partagés et tous les
workspaces qui le déclarent directement utilisent exactement cette version.
Tous ceux qui déclarent `@types/node` utilisent exactement `24.10.15`. Le
lockfile reste la source reproductible et toute évolution ultérieure de ce
baseline est une mise à jour revue, jamais une résolution implicite du hoist.

Après `npm ci`, chaque OS de la matrice exécute `npm ls`. Ubuntu exécute le gate
complet `npm run verify`; macOS et Windows conservent `npm run validate` afin de
maintenir la couverture portable sans tripler les tests et builds produit.
Les étapes ciblées d’intégration, d’audit et de documentation restent explicites
pour leurs artefacts CI.

## Conséquences

Un paquet invalide ou extraneous bloque localement et en CI. Le compilateur
utilisé par UI, Web, Extension et Public Discovery est identique. La politique
ne corrige pas une suspension GitHub pour facturation : ce prérequis externe
reste une opération de compte séparée avant que le workflow puisse démarrer.
