# CI/CD du blueprint

Le workflow GitHub Actions valide le template sur Linux, macOS et Windows avec
Node.js 22.13+, npm 10+, Python 3.12 et uv 0.11.2. Les Actions d'installation
sont épinglées par SHA. Il s'exécute sur chaque push, pull request et lancement
manuel.

Le pipeline installe les dépendances depuis `package-lock.json`, synchronise
CRG avec `uv sync --frozen`, vérifie sa version et son transport MCP, exécute le
gate `npm run validate`, audite les dépendances et génère la documentation. Le
Sensor couvre tous les fichiers suivis du blueprint avec
une baseline versionnée ; seules les nouvelles alertes bloquantes sont publiées
dans GitHub code scanning. Les artefacts contiennent aussi le rapport JSON
complet, le smoke CRG, le HTML Archify et un résumé. Sur Linux,
`archify:visual-check` produit les captures clair/sombre, la contact sheet et le
reçu JSON aux quatre résolutions ; le containment est bloquant tandis que
`visualReview` reste `pending`. Les chemins et diagnostics
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

Deux workflows distincts gèrent la revue CRG des PR. Le workflow non privilégié
checkout le code PR avec `contents: read`, exécute l'Action officielle épinglée
au commit v2.3.8 avec une contrainte pip versionnée, applique le seuil `high`
(0,70) et publie le rapport même si le gate échoue. Le workflow `workflow_run`
de confiance ne checkout aucun code PR : il télécharge un unique artefact
borné, vérifie fichiers, tailles, encodage, numéro, SHA et format, neutralise les
mentions, puis met à jour le commentaire sticky avec seulement `actions: read`
et `pull-requests: write`.

Après le premier run distant réussi, rendre le check **CRG risk gate**
obligatoire sur `main`, en le conservant avec les quatre checks déjà requis,
`strict: true`. Le workflow de commentaire ne doit pas être obligatoire.
Les Actions internes à l'Action composite CRG sont des dépendances transitives
du commit officiel et sont réévaluées lors de toute mise à jour du pin.
