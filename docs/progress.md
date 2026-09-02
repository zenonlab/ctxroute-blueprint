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
