# CI/CD du blueprint

Le workflow GitHub Actions valide le template sur Linux, macOS et Windows avec
Node.js 22.13+, npm 10+, Python 3.12 et uv 0.11.2. Les Actions d'installation
sont épinglées par SHA. Il s'exécute sur chaque push, pull request et lancement
manuel.

Le pipeline installe les dépendances depuis `package-lock.json`, synchronise
CRG avec `uv sync --frozen`, vérifie sa version et les manifestes MCP, puis
teste le transport de l'orchestrateur CTXRoute sur les trois systèmes. Le transport CRG officiel
est testé sur Linux et macOS ; Windows conserve la validation de sa version,
de son manifeste et de son allowlist. Le pipeline exécute ensuite le gate
`npm run validate`, audite les dépendances et génère la documentation. Le
Sensor couvre tous les fichiers suivis du blueprint avec
une baseline versionnée ; seules les nouvelles alertes bloquantes sont publiées
dans GitHub code scanning. Les artefacts contiennent aussi le rapport JSON
complet, le smoke CRG et un résumé. Lorsqu'un projet déclare des diagrammes
produit, ils contiennent également le HTML Archify et, sur Linux, les captures
clair/sombre, la contact sheet et le reçu JSON aux quatre résolutions ; le
containment est bloquant tandis que
`visualReview` reste `pending`. Les chemins et diagnostics
exportés doivent rester exempts de secrets.

Le CD du blueprint signifie uniquement la publication manuelle ou conditionnelle
de la documentation Archify. Aucun produit, backend, frontend, fournisseur
cloud, secret ou environnement de production n'est imposé. Un projet dérivé
doit ajouter son propre workflow de déploiement, ses secrets, ses contrôles et
sa stratégie de rollback.

Pendant une modification, utiliser le test ou validateur ciblé. Exécuter
`npm run validate` une fois par chantier cohérent, puis `npm run verify` avant
une livraison. Le smoke job CI et Codespaces exécutent le bootstrap réel. Dans
Codex, l'approbation des
neuf définitions de `/hooks` reste une action manuelle ; le dépôt ne modifie pas
les réglages globaux Codex ou Claude.

Trois workflows distincts gèrent la revue CRG des PR. Le workflow non privilégié
checkout le code PR avec `contents: read`, exécute l'Action officielle épinglée
au commit v2.3.8 avec une contrainte pip versionnée, applique le seuil `high`
(0,70) et publie le rapport même si le gate échoue. Le workflow `workflow_run`
de confiance ne checkout aucun code PR : il télécharge un unique artefact
borné, vérifie fichiers, tailles, encodage, numéro, SHA et format, neutralise les
mentions, puis met à jour le commentaire sticky avec seulement `actions: read`
et `pull-requests: write`. Le workflow privilégié `CRG disposition` ne checkout
que la branche par défaut de confiance. Il revalide l’artefact, le numéro de PR,
le SHA, le score et le digest. Un risque inférieur à `high` passe directement.
Un risque `high` ou `critical` exige une review `APPROVED` sur ce SHA par un
administrateur distinct de l’auteur, avec une ligne `Justification:` de 32 à 512
caractères, une issue de suivi et `CRG-report-sha256:<digest>`. L’acceptation
produit un artefact `CrgRiskAcceptance`; tout nouveau SHA ou rapport l’invalide.

Après le premier run distant réussi, rendre le check **CRG disposition**
obligatoire sur `main` à la place du check brut, en le conservant avec tous les checks déjà requis,
`strict: true`. Le workflow de commentaire ne doit pas être obligatoire.
Les Actions internes à l'Action composite CRG sont des dépendances transitives
du commit officiel et sont réévaluées lors de toute mise à jour du pin.
