---
scope:
  - scripts/release/**
  - scripts/infra/**
  - apps/extension/package.json
  - apps/web/published-extension.json
  - .github/workflows/**
  - docs/release.md
  - docs/operations/**
  - docs/browser-support.md
review: on-change
revised: true
---
# ADR-0059 — Publication reproductible de l'extension 1.0.43

- Status: accepted
- Date: 2026-09-20

## Context

La candidate 1.0.43 doit corriger la convergence des favoris sans
réécrire les archives publiques 1.0.42. Une archive locale ne doit pas pouvoir
être transférée si sa taille ou son hash diverge du manifeste produit.

## Decision

Le packager prépare les types WXT avant chaque build, produit Chrome et Firefox
avec le toolchain Node 22/npm verrouillé par la CI, et conserve dans
`release-manifest.json` la version, le nombre de fichiers, la taille, le
SHA-256 et le manifeste MV3 de chaque archive. Deux sorties isolées sont
comparées byte à byte.

La pipeline installe Chromium Playwright et exécute les neuf scénarios E2E
existants, puis vérifie les probes publiques `/`, `/library`, `/download`
et gateway `/healthz`. La gate Cloudflare recalcule les artefacts avant tout
upload et n'autorise que les deux objets R2 1.0.43 et le pointeur correspondant.

## Consequences

Les ZIP 1.0.42 restent immuables et servent de rollback. Une divergence de
manifestes, d'octets, de hash ou de taille bloque avant mutation distante.
L'avancement du pointeur est une opération séparée et protégée, après preuve
des deux téléchargements publics.
