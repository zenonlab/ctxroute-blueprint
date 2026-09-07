# Reprise de session — Wallpaper

Mise à jour : 7 septembre 2026. Phase : cadrage produit documenté,
choix techniques reportés à la prochaine session.

## Commencer ici

Lire [AGENTS.md](../AGENTS.md), la [vision produit](00-project-brief.md), puis
les [questions techniques](01-technology-decisions.md).
Le projet reste volontairement au statut `template`. Ne pas lancer
`npm run initialize` ni développer le produit avant la discussion technique.

## Ce que l'utilisateur a confirmé

- Un bureau interactif et un terminal personnalisé, avec une fusion visuelle
  mais aussi les modes terminal seul et bureau seul.
- Des sessions de shells et d'agents représentées par des joueurs sélectionnables.
- Mario Kart et la liste des joueurs en haut à droite comme exemple, pas comme
  jeu pilote ou disposition définitivement choisis.
- Des personnages interchangeables et des données de jeu isolées pour recomposer
  les thèmes ; changer d'apparence doit préserver le travail.
- Linux, macOS et Windows comme cible, avec couverture exacte encore à définir.
- Créer le moins possible nous-mêmes : examiner l'existant avant la stack.

## État du socle et provenance

Le dossier était vide. Le template a été cloné depuis
[zenonlab/ctxroute-blueprint](https://github.com/zenonlab/ctxroute-blueprint),
révision `dbfb2e054b311c642ca75cc2ec35d605a42f1c1d`.
Son historique et ses notices de licence sont conservés. Aucun dépôt distant
produit n'a été créé et aucun push n'est prévu pour cette étape.
Le remote `origin` désigne encore le blueprint amont : ne pas y pousser le produit.

Environnement observé : macOS, Node 24.18.0, npm 11.16.0, Python système 3.12.0,
uv 0.11.2, Git 2.52.0. L'environnement CRG utilise Python 3.12.10.

`npm run setup` a terminé avec succès avant les modifications documentaires :
installation verrouillée, CTXRoute 2.0.0, Archify 2.16.0, Code Review Graph 2.3.8,
construction du graphe local, activation de `.githooks` et validation du template.
La couverture globale rapportée était 91,09 % lignes, 75,44 % branches et
88,55 % fonctions. Ces mesures concernent le template.

Les manifests MCP du projet déclarent `ctxroute-orchestrator` et
`code-review-graph`. Leur présence ne prouve pas leur chargement dans le client.
À la nouvelle session ouverte depuis ce dossier, vérifier `/mcp` et approuver
les six définitions locales dans `/hooks` si Codex le demande, conformément
au [guide amont conservé](../README.md). Aucune configuration globale modifiée.

## Vérification finale

Le second passage de `npm run verify` a terminé avec succès : validation,
tests du template, smoke CRG, intégration MCP, audit npm et génération HTML.
La suite rapporte 262 tests, 261 réussis, aucun échec ; couverture globale
91,10 % lignes, 75,55 % branches et 88,88 % fonctions. L'intégration rapporte
trois tests réussis. L'audit npm ne signale aucune vulnérabilité.
La configuration conserve bien `status: template` après ces contrôles.

Le schéma conceptuel possède une validation showcase Archify à neuf contrôles,
sans erreur ni avertissement de composition. Sa livraison HTML a réussi.
Le contrôle visuel automatique a réussi à 1440×900, 1600×1000, 1920×1080 et
2048×1320, sans débordement. Les captures claire à 1440×900 et sombre à
2048×1320 ont également été inspectées par l'agent. Le reçu automatique conserve
`visualReview: pending` pour une éventuelle revue humaine.

Artefact : `dist/architecture/product-vision.architecture.html`.
Empreinte SHA-256 source :
`922834c6c73b156e66edb8bc7070f79563845b1ef371c41eae6edc435c072b5e`.
Empreinte SHA-256 HTML :
`c5e6d3fb1285fdb59c76827c60cc66cc03c4783e9c73d3d7088abce0877a81a0`.

Le premier passage de `npm run verify` après rédaction a révélé que le test
d'initialisation pouvait interpréter les décisions rédigées comme complètes et
modifier le statut local. Le statut a été rétabli à `template`, et les champs
de décisions encore ouvertes utilisent désormais les marqueurs entre crochets
reconnus par le validateur amont. Conserver ces marqueurs jusqu'aux décisions
techniques évite une initialisation prématurée ; aucun hook n'a été modifié.

## Ce qui n'est pas réalisé

Aucun terminal, moteur graphique, extracteur, ROM importée ou intégration OS.
Aucun benchmark produit et aucune preuve d'exécution sur Linux ou Windows.
Aucune API ou format `.scene` adopté. Aucune stack produit sélectionnée.
La [recherche archivée](research/initial-research.md) est une synthèse explicitement
non verbatim du texte initial ; ses chiffres et références restent à vérifier.

## Prochaine conversation

Comparer les solutions existantes pour terminal, bureau multiplateforme et
assets ; choisir ensuite un premier parcours démontrable et un jeu pilote.
Définir le modèle de session, les limites de personnalisation et les budgets
avant de décider langage, rendu, packaging ou infrastructure.

Prompt de reprise possible :

> Lis docs/session-handoff.md et le brief produit. Nous allons choisir les
> technologies et l'infrastructure en réutilisant au maximum l'existant.
> Compare d'abord les bases possibles pour un terminal et un bureau ludiques
> modulaires sur Linux, macOS et Windows. Ne considère pas la stack de la
> recherche initiale comme déjà décidée.
