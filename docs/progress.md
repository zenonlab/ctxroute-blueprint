# Progress checklist

## Tableau web local pour CTXRoute Progress — DONE

- [x] **Construire le serveur local sécurisé, l’API révisée et l’interface accessible** — DONE _(evidence: node --test tests/progress-dashboard.test.mjs, npx eslint scripts/progress-dashboard*.mjs tests/progress-dashboard.test.mjs)_
- [x] **Exposer progress_open_dashboard et gérer l’instance éphémère** — DONE _(evidence: npm run mcp:smoke, node --test tests/progress-mcp.test.mjs)_
- [x] **Injecter le lien une fois par session depuis Stop** — DONE _(evidence: node --test tests/hooks.test.mjs, node --test tests/progress-dashboard.test.mjs)_
- [x] **Documenter et valider le control plane Progress** — DONE _(evidence: node .githooks/archify validate internal, npm run validate, npm run crg:smoke)_
