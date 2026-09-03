# Progress checklist

## Tableau web local pour CTXRoute Progress — DONE

- [x] **Construire le serveur local sécurisé, l’API révisée et l’interface accessible** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs, npx eslint scripts/progress-dashboard*.mjs tests/progress-dashboard.test.mjs)_
- [x] **Exposer progress_open_dashboard et gérer l’instance éphémère** — DONE _(evidence: npm run mcp:smoke, node --test tests/progress-mcp.test.mjs)_
- [x] **Injecter le lien une fois par session depuis Stop** — DONE _(evidence: node --test tests/hooks.test.mjs, node --test tests/progress-dashboard.test.mjs)_
- [x] **Documenter et valider le control plane Progress** — DONE _(evidence: node .githooks/archify validate internal, npm run validate, npm run crg:smoke)_

## Refonte sobre du tableau CTXRoute Progress — DONE

- [x] **Étendre les mutations atomiques et les validations Progress** — DONE _(evidence: node --test tests/progress-core.test.mjs, npx eslint scripts/progress-core.mjs tests/progress-core.test.mjs)_
- [x] **Exposer les routes révisées du tableau local** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs, npx eslint scripts/progress-dashboard.mjs tests/progress-dashboard.test.mjs)_
- [x] **Construire les cartes accordéons autosauvegardées et accessibles** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs, Chrome headless 390x844 and 1440x1000: scrollWidth equals viewport, 4 closed cards, no JavaScript errors, Chrome interaction smoke: DONE proof guard, focus, undo redo, slug)_
- [x] **Aligner le contrat UI les ADR et les diagrammes internes** — DONE _(evidence: npm run mcp:smoke, node --test tests/progress-core.test.mjs tests/progress-dashboard.test.mjs tests/progress-mcp.test.mjs, npm run validate)_

## Polir l’expérience du tableau Progress — DONE

- [x] **Corriger les défauts UX visibles et compacter les goals terminés** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs, Chrome visual review mobile and desktop)_
- [x] **Vérifier les états UX sur mobile et bureau** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs, npx eslint and oxlint dashboard client tests, Chrome 390x844 and 1440x1000: no overflow or JavaScript errors)_

## Rendre CTXRoute Progress durable et authentifié — DONE

- [x] **Conserver le jeton lors des rechargements** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs — 11/11 passing, Same-tab reload test restores the token from sessionStorage)_
- [x] **Supprimer l expiration par défaut du serveur** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs — explicit expiry and durable default pass, Detached instance health 200 and authenticated API 200)_
- [x] **Aligner le contrat et les diagrammes internes** — DONE _(evidence: node .githooks/archify validate internal — 3/3 internal diagrams pass, npm run validate — 266 tests pass, 1 skipped, 0 failures)_

## Rendre Progress automatique par défaut et manuel seulement aux vrais points de décision — DONE

- [x] **Remplacer le blocage systématique par un routage automatic/manual ciblé** — DONE _(evidence: node --test tests/progress-core.test.mjs tests/hooks.test.mjs tests/progress-dashboard.test.mjs tests/mcp-stdio.test.mjs — 113 pass, 1 skip, node .githooks/archify validate internal — 3 diagrams pass, npm run validate — 267 pass, 1 skip)_
