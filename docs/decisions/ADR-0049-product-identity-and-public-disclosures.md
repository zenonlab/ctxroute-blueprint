---
scope:
  - package.json
  - package-lock.json
  - apps/web/app/privacy/page.tsx
  - docs/browser-support.md
  - docs/systems/agenda-recovery-plan.md
  - docs/architecture/src/production-surface.architecture.json
  - docs/architecture/src/extension-delivery-validation.dataflow.json
  - docs/architecture/src/public-pipeline.architecture.json
review: on-change
revised: true
---

# ADR-0049 — Identité produit et déclarations publiques

- Status: accepted
- Date: 2026-09-15

## Contexte

Le manifeste npm racine conservait le nom, la description et les liens du
template `ctxroute-blueprint`. La page de confidentialité décrivait aussi un
appel direct de l’extension aux catalogues fournisseurs, alors que Public
Discovery v3 passe exclusivement par l’API TobiRink et son consumer Queue natif.
Plusieurs preuves de livraison affichaient encore la version 1.0.0 ou un état
navigateur antérieur.

## Décision

Le package privé racine porte le nom `tobirink`, décrit le produit local-first
et référence le dépôt `tristan-monticelli/Tobirink`. Les packages internes de
gouvernance gardent leurs noms propres : ils restent des outils embarqués et ne
définissent pas l’identité du produit.

La déclaration publique distingue les données privées locales des demandes de
découverte publiques. L’extension peut envoyer à l’API TobiRink des titres
normalisés et bornés ou un identifiant fournisseur public explicite. Elle
n’envoie jamais l’URL brute du favori, ses dossiers, la progression ou la
bibliothèque au Worker, à D1 ou aux fournisseurs. Seul le consumer Queue natif
appelle les APIs fournisseurs, au travers du transport serveur isolé.

Les documents et diagrammes actifs reflètent désormais la version extension 1.0.31, les
deux builds MV3 vérifiés et les migrations D1 versionnées. Ils distinguent une
configuration locale préparée d’une cadence ou publication effectivement
observée; aucune cible locale non poussée n’est présentée comme déployée.

## Conséquences

Les métadonnées, la page de confidentialité et les preuves d’architecture
nomment le même produit et la même frontière réseau. Une future cadence ou
version ne doit être déclarée active qu’après sa publication et sa vérification
séparées. Les opérations de push, déploiement et publication restent hors de
cette décision documentaire.
