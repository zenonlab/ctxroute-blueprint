---
scope:
  - .github/workflows/deploy-production.yml
  - apps/provider-gateway/deno.jsonc
  - docs/operations/cloudflare.md
  - docs/architecture/src/production-surface.architecture.json
  - docs/architecture/src/production-publication.dataflow.json
review: on-change
revised: true
---

# ADR-0055 — Livraison de production protégée depuis GitHub

- Status: accepted
- Date: 2026-09-19

## Contexte

Le dépôt possède une application gateway Deno liée à GitHub et un Worker
Cloudflare livré par une gate repository-owned. Une livraison autonome doit
rester bornée aux changements vérifiés et ne doit pas transformer GitHub en
accès général aux ressources Cloudflare.

## Décision

L’application Deno Deploy liée au dépôt construit automatiquement la gateway
sur les changements de `main`. Son répertoire `apps/provider-gateway` reste
configuré dans le tableau de bord Deno, tandis que `deno.jsonc` fixe le runtime
dynamique et `src/index.ts` comme entrypoint.

Un workflow GitHub déclenché par `main` ou manuellement s'exécute uniquement sur
le runner auto-hébergé enregistré avec les labels `self-hosted`, `macOS`,
`ARM64`, `cloudflare-ci`. Il exécute `npm run verify`, génère un plan Cloudflare
expirant, vérifie son digest et applique uniquement
`worker:tobirink-public-api`. Les pull requests n’ont aucun job de déploiement
et le job ne possède que `contents: read`.

Les secrets `CLOUDFLARE_API_TOKEN` et `CLOUDFLARE_ACCOUNT_ID` sont des secrets
d’environnement GitHub. `PROVIDER_GATEWAY_HMAC_KEY` reste un secret runtime
séparé du dépôt, présent côté Worker et gateway; aucune valeur secrète n’est
versionnée. D1, Queue, R2 et les secrets fournisseur ne sont pas mutés par ce
workflow. Les canaries et la promotion métier restent des contrôles distincts.

## Conséquences

Un échec de vérification ou de plan bloque la livraison. Le rollback sélectionne
la révision Deno ou la version Worker précédente via leurs contrôles opérateur,
sans supprimer les données D1, objets R2 ou messages Queue.
