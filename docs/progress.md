# Progress checklist

## Désactiver le protocole legacy Public Discovery v2 — DONE

- [x] **Répondre 410 aux routes v2 et retirer leur identité OIDC** — DONE _(evidence: Progress history archived to .project/progress-archive-2026-09-15.json, Worker tests 57/57 and all workspace typechecks pass, All legacy v2 route tests return 410; v3 remains covered)_

## Publier le retrait du protocole Public Discovery v2 — DONE

- [x] **Vérifier, versionner, pousser et déployer le Worker** — DONE _(evidence: npm run verify passed; pre-push lint, coverage, integration and documentation gates passed, Commit c0a797d pushed to origin/main without .codex/config.toml, Cloudflare plan 21460c98 deployed only worker:tobirink-public-api as version a1c2e5cc)_

## Sécuriser l’atomicité et les états de Public Discovery D1 — DONE

- [x] **Rendre la publication atomique et terminer les demandes épuisées** — DONE _(evidence: Tests D1 Cloudflare 15/15: bail remplacé, bail expiré, conflit fournisseur, huitième tentative FAILED/UNAVAILABLE et reprise POST identique sans écriture partielle, Tests HttpPublicDiscoveryAdapter 3/3 et FavoriteResolutionRunner 39/39: UNAVAILABLE ne déclenche aucun fournisseur ni resoumission automatique, Tous les typechecks passent; validations ADR et documentation passent)_

## Minimiser et dédupliquer Public Discovery — DONE

- [x] **Borner les titres, indexer les identités et définir la rétention** — DONE _(evidence: Contrats et génération applicative limitent et dédupliquent les deux listes à 4; tests Public Discovery 50/50 et runner 39/39, Migration D1 0014 ajoute index canonique versionné, échéances FAILED/nonces et plans d’index; tests Worker 64/64 couvrent 503, collision atomique, rejeu historique et expurgation, ADR-0046, stratégie qualité, runbook et dataflow mis à jour; Archify showcase 9/9, 0 erreur, 0 avertissement, artefact SHA-256 f4c47121bb5fdd54d7a1234c1946d201eb37b87b9f4d12aa212d4502fe7e9baa)_
