# CI/CD du blueprint

Le workflow GitHub Actions valide le template sur Linux, macOS et Windows avec
Node.js 22.13+ et npm 10+. Il s'exécute sur chaque push, pull request et lancement
manuel.

Le pipeline installe les dépendances depuis `package-lock.json`, exécute le gate
`npm run validate`, vérifie l’intégration MCP, audite les dépendances et génère
la documentation. Le Sensor couvre tous les fichiers suivis du blueprint avec
une baseline versionnée ; seules les nouvelles alertes bloquantes sont publiées
dans GitHub code scanning. Les artefacts contiennent aussi le rapport JSON
complet, le HTML Archify, le benchmark et un résumé. Les chemins et diagnostics
exportés doivent rester exempts de secrets.

Le CD du blueprint signifie uniquement la publication manuelle ou conditionnelle
de la documentation Archify. Aucun produit, backend, frontend, fournisseur
cloud, secret ou environnement de production n'est imposé. Un projet dérivé
doit ajouter son propre workflow de déploiement, ses secrets, ses contrôles et
sa stratégie de rollback.

Après un clone local, exécuter `npm run setup`, puis `npm run verify` avant une
livraison. Le smoke job CI et Codespaces exécutent le bootstrap réel. Dans
Codex, l'approbation des
six définitions de `/hooks` reste une action manuelle ; le dépôt ne modifie pas
les réglages globaux Codex ou Claude.
