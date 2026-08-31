# CI/CD du blueprint

Le workflow GitHub Actions valide le template sur Linux, macOS et Windows avec
Node.js 22 et npm 10+. Il s'exécute sur chaque push, pull request et lancement
manuel.

Le pipeline installe les dépendances depuis `package-lock.json`, vérifie
CTXRoute, Archify, les documents, l'UI contract, le Sensor, les hooks et les
tests. Il publie des artefacts de validation : HTML Archify, SARIF Sensor et
un résumé. Les chemins et diagnostics exportés doivent rester exempts de
secrets.

Le CD du blueprint signifie uniquement la publication manuelle ou conditionnelle
de la documentation Archify. Aucun produit, backend, frontend, fournisseur
cloud, secret ou environnement de production n'est imposé. Un projet dérivé
doit ajouter son propre workflow de déploiement, ses secrets, ses contrôles et
sa stratégie de rollback.

Après un clone local, exécuter `npm run setup`. Dans Codespaces, le
`postCreateCommand` exécute cette même commande. Dans Codex, l'approbation des
six définitions de `/hooks` reste une action manuelle ; le dépôt ne modifie pas
les réglages globaux Codex ou Claude.
