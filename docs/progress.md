# Progress checklist

## Désactiver le protocole legacy Public Discovery v2 — DONE

- [x] **Répondre 410 aux routes v2 et retirer leur identité OIDC** — DONE _(evidence: Progress history archived to .project/progress-archive-2026-09-15.json, Worker tests 57/57 and all workspace typechecks pass, All legacy v2 route tests return 410; v3 remains covered)_

## Publier le retrait du protocole Public Discovery v2 — DONE

- [x] **Vérifier, versionner, pousser et déployer le Worker** — DONE _(evidence: npm run verify passed; pre-push lint, coverage, integration and documentation gates passed, Commit c0a797d pushed to origin/main without .codex/config.toml, Cloudflare plan 21460c98 deployed only worker:tobirink-public-api as version a1c2e5cc)_

## Sécuriser l’atomicité et les états de Public Discovery D1 — DONE

- [x] **Rendre la publication atomique et terminer les demandes épuisées** — DONE _(evidence: Tests D1 Cloudflare 15/15: bail remplacé, bail expiré, conflit fournisseur, huitième tentative FAILED/UNAVAILABLE et reprise POST identique sans écriture partielle, Tests HttpPublicDiscoveryAdapter 3/3 et FavoriteResolutionRunner 39/39: UNAVAILABLE ne déclenche aucun fournisseur ni resoumission automatique, Tous les typechecks passent; validations ADR et documentation passent)_

## Minimiser et dédupliquer Public Discovery — DONE

- [x] **Borner les titres, indexer les identités et définir la rétention** — DONE _(evidence: Contrats et génération applicative limitent et dédupliquent les deux listes à 4; tests Public Discovery 50/50 et runner 39/39, Migration D1 0014 ajoute index canonique versionné, échéances FAILED/nonces et plans d’index; tests Worker 64/64 couvrent 503, collision atomique, rejeu historique et expurgation, ADR-0046, stratégie qualité, runbook et dataflow mis à jour; Archify showcase 9/9, 0 erreur, 0 avertissement, artefact SHA-256 f4c47121bb5fdd54d7a1234c1946d201eb37b87b9f4d12aa212d4502fe7e9baa)_

## Aligner les contrats internes Public Discovery sur v3 — DONE

- [x] **Renommer le runtime, les tables et le schéma filaire vers v3** — DONE _(evidence: Contrat portable 51/51, adaptateur navigateur 3/3 et Worker 65/65 passent avec schemaVersion 3 et noms V3., Migration 0015 renomme les tables actives vers _v3; test D1 prouve la conservation d’une ligne PENDING et la disparition de l’ancien nom., Le test FAILED réarme par POST identique puis réclame attempt 1; audit rg ne trouve des marqueurs v2 que dans transitions, test négatif et routes 410.)_

## Préparer le collecteur public v3 à cadence dix minutes — DONE

- [x] **Synchroniser et vérifier le dépôt public localement** — DONE _(evidence: Clone public local propre sur refactor/public-discovery-v3; commit 51742d9 sans push, dispatch ni mutation fournisseur., Sources alignées exactement sur packages/public-discovery/src; contrat v3, listes 4+4 et état UNAVAILABLE couverts par 51 tests., npm ci --ignore-scripts, npm run verify et npm ls réussissent; workflow */10 et workflow_dispatch conservé; lockfile inchangé.)_

## Retirer les fournisseurs du runtime de l’extension — DONE

- [x] **Acheminer les identités manuelles par Public Discovery v3** — DONE _(evidence: Manual Review uses a provider+ID-specific SHA-256 key and Public Discovery v3; PENDING and exact VERIFIED behavior are covered by 7 application and 25 extension targeted tests., Chrome/Firefox manifests expose only https://tobirink.com/*, no declarativeNetRequest permission/resource; executable background bundles contain none of the four provider API origins., npm run verify and npm ls pass after the shared toolchain alignment; no provider call, deployment, publication, push or file deletion was performed.)_

## Aligner l’outillage workspace et le gate CI — DONE

- [x] **Unifier TypeScript et rendre npm ls bloquant** — DONE _(evidence: npm ci --ignore-scripts and npm ls pass with one TypeScript 7.0.2 baseline and @types/node 24.10.15., All workspace typechecks and 141 targeted UI tests pass; npm run verify passes fully with npm audit reporting 0 vulnerabilities., CI runs npm ls on every matrix OS, npm run verify on Ubuntu, and cross-platform validation on macOS and Windows; ADR-0048 and coherence checks pass.)_

## Borner WebBridge et renforcer la confiance OIDC — DONE

- [x] **Plafonner les sessions locales et le cache JWKS** — DONE _(evidence: WebBridge tests 7/7 prove 32-session LRU, 64 IDs per session, 512 IDs globally, closed quotas and expired-session purge behavior., OIDC tests prove immutable repository 1370309060 and owner 239743354, 3-second abort, 5-minute cache reuse/expiry, kid rotation and 16-key rejection; security suites pass Extension 9/9 and Worker 15/15., All workspace typechecks and npm run verify pass; npm audit reports 0 vulnerabilities and Chrome/Firefox MV3 builds succeed.)_

## Aligner l’identité produit, la confidentialité et les preuves publiques — DONE

- [x] **Corriger les métadonnées et la documentation produit active** — DONE _(evidence: Web 13/13, toutes les suites workspace et tous les typechecks passent; Extension 148/148, Worker 65/65, Application 378/378., npm run verify réussit intégralement, builds Chrome/Firefox inclus; npm audit rapporte 0 vulnérabilité et npm ls est propre., Archify valide et matérialise les diagrammes en showcase 9/9 sans erreur ni avertissement; production-surface artefact e3d5d6a1adcdbfa60a081463bea01ed32c2e18c33c3fdeb9dc9b6ddf19e209c2, extension-delivery artefact d4cfc9cb3835e6a0566c0daf1f58af9ef2ef55e4880223b819852dd668783188.)_

## Distinguer la cadence Discovery déployée de la cible locale — DONE

- [x] **Corriger la cadence dans le diagramme de pipeline publique** — DONE _(evidence: Le diagramme distingue Discovery quotidien 03:23 UTC déployé et cible dix minutes locale non poussée., Archify showcase passe 9/9 sans diagnostic; artefact public-pipeline 8f88a348680d90c136b5e01ef6377f295a8cceb2174950c90f0018f25ef0304e., Validations ADR/docs et build documentaire réussissent; le npm run verify complet du commit précédent est vert.)_

## Retirer les fallbacks fournisseur morts de l’extension — DONE

- [x] **Supprimer les runtimes directs et préserver la compatibilité IndexedDB** — DONE _(evidence: Dix fichiers legacy supprimés; aucun symbole fournisseur/fallback actif trouvé hors tests négatifs., Chrome et Firefox MV3 construits à 20 fichiers, uniquement https://tobirink.com/*, sans DNR., Migration IndexedDB v19 Chromium réussie; npm run verify, npm ls --all, npm audit et git diff --check réussissent.)_

## Certifier la candidate extension 1.0.31 sans fournisseur — DONE

- [x] **Versionner, packager et certifier 1.0.31 localement** — DONE _(evidence: Candidate 1.0.31: Chrome 291601 octets SHA-256 a4bf87ecc73f03566ad84d8a6b2d8ee61dae0fe6e1cbf3f9f1897afb81dbd390; Firefox 291642 octets SHA-256 01657bc68988fc97360881f7a2f6bd431e52d82dbfc95440fb0ca58a545e3358., Deux builds isolés byte-identiques; 20 fichiers chacun, manifestes uniquement https://tobirink.com/*, aucun DNR ni origine fournisseur dans le background., npm run verify, npm ls --all, validations ADR/docs et git diff --check réussissent; npm audit 0 vulnérabilité.)_
