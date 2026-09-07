# Vision produit — bureau et terminal ludiques

État : cadrage produit, 7 septembre 2026. Nom de travail : Wallpaper.
Aucun moteur, terminal ou extracteur produit n'est encore implémenté.
Le statut du dépôt reste `template` jusqu'à la session de décisions techniques.

## Synthèse

Créer un environnement de travail personnel inspiré des jeux vidéo, dans lequel
un décor interactif et un terminal personnalisé forment une expérience cohérente.
L'objectif est de rendre le travail agréable et personnalisable, avec de vrais
terminaux et agents derrière les personnages et les objets cliquables.

L'utilisateur initial travaille avec plusieurs shells et agents de programmation.
Les « joueurs » représentent ces sessions, pas des utilisateurs distants ni une
fonction multijoueur. Un personnage est une représentation interchangeable :
son identité visuelle ne doit pas devenir l'identité technique de la session.

## Modes et modularité

| Mode | Expérience attendue |
| --- | --- |
| Terminal seul | Un terminal utilisable comme outil de travail, avec thème et sélecteur de sessions, sans activer le bureau animé. |
| Bureau seul | Un décor interactif, des objets et des raccourcis, sans obligation d'utiliser le terminal personnalisé. |
| Ensemble intégré | Décor, terminal et sélecteur de joueurs se répondent dans une expérience commune. |

La fusion visuelle est souhaitée ; elle ne décide ni du nombre d'applications,
ni du nombre de processus, ni du packaging. Les modules doivent pouvoir évoluer
et être activés indépendamment. On veut pouvoir changer de jeu, de décor,
de personnage, de disposition ou d'ambiance sans reconstruire le produit.

## Parcours de référence

1. L'utilisateur choisit un thème inspiré de Mario Kart et ouvre deux terminaux,
   dont l'un exécute un agent. Des portraits de joueurs représentent les sessions,
   par exemple en haut à droite.
2. Il clique sur un portrait : le terminal correspondant devient accessible.
   La saisie clavier va au terminal uniquement lorsqu'il le choisit explicitement.
3. Il remplace le personnage d'une session : les commandes et le travail en cours
   continuent, sans recréer la session.
4. Il clique sur un objet configuré du décor pour ouvrir une session, une
   application ou une destination. L'objet reste distinct de l'action associée.
5. Il passe à un thème différent ou désactive le décor animé : il conserve
   l'accès à ses sessions de travail.

Mario Kart est un exemple de langage visuel, pas le premier jeu définitivement
retenu. La liste en haut à droite est une piste de disposition, pas une position
immuable. Le terminal doit rester lisible et utilisable : texte, sélection,
copier-coller, défilement, raccourcis et navigation clavier priment sur le décor.

## Données de jeu et personnalisation

L'ambition exprimée est de disposer des données du jeu et d'en isoler les éléments
pour les réutiliser : environnements, personnages, objets, textures, squelettes,
animations, sons, musiques et éléments d'interface lorsqu'ils sont disponibles.

Un asset est un élément réutilisable ; un thème en compose plusieurs avec une
présentation ; une session porte le travail ; une association relie la session
à un personnage ou une action à un objet. Ce vocabulaire décrit le produit,
pas un schéma de données ou une API déjà approuvés.

La couverture devra être démontrée par jeu, version et catégorie d'asset.
Importer une scène ne prouve pas que tous les personnages, animations, sons ou
comportements du jeu sont récupérables. Les dépendances entre éléments doivent
rester explicites pour éviter de promettre des échanges incompatibles.
Les possibilités de composition entre plusieurs jeux restent à étudier.

## Contraintes

- Linux, macOS et Windows font partie de la cible produit. Les versions minimales
  et environnements Linux supportés seront décidés après investigation.
- Le bureau doit préserver les icônes, les clics destinés aux applications,
  le focus et les usages normaux du système.
- La décoration doit consommer peu de ressources et pouvoir ralentir ou
  se suspendre. Les budgets seront mesurés sur du matériel identifié.
- L'absence d'émulateur permanent reste une orientation issue de la recherche
  initiale ; la stratégie d'ingestion est à évaluer.
- Le changement d'apparence ne doit pas interrompre le travail. La survie des
  processus à la fermeture complète ou au redémarrage est une décision distincte.
- Les actions système doivent correspondre aux associations configurées par
  l'utilisateur. Un asset importé ou un nom suggéré par IA n'autorise pas,
  à lui seul, l'exécution d'une commande.
- Réutiliser au maximum les composants existants. Toute création spécifique doit
  expliquer le manque concret de l'existant et son coût de maintenance.

## Décisions

Confirmé par l'utilisateur : expérience intégrée mais modulaire, terminal et
bureau utilisables seuls, sessions de terminaux et d'agents, personnalisation
des joueurs, isolation des données de jeu, cible des trois OS et priorité à
la réutilisation.

Reporté à la prochaine session : langage, runtime, interface, rendu, intégration
desktop, terminal/PTY, gestion des agents, stockage, format d'assets, packaging,
observabilité, sécurité détaillée et budgets de performance.
Aucun backend distant, compte utilisateur ou service cloud n'est demandé.
L'usage personnel local est l'hypothèse de travail, pas une interdiction future.

Voir les [questions techniques](01-technology-decisions.md) et la
[décision de cadrage](decisions/ADR-0029-product-framing.md).

## Critères de réussite

Pour cette étape : un socle CTXRoute installé, une documentation cohérente,
un schéma conceptuel validé et une note permettant de reprendre sans relire
la conversation. Aucun code produit ni stack produit sélectionnée.

Pour le futur produit : les trois modes sont utilisables, chaque joueur ouvre
la bonne session, changer d'apparence conserve le travail, les assets disponibles
sont recomposables et les interactions natives du bureau sont préservées.
Les preuves devront être établies sur Linux, macOS et Windows.

Les [scénarios d'acceptation](02-quality-strategy.md) sont des exigences à tester,
pas des fonctionnalités livrées. La [recherche initiale](research/initial-research.md)
et sa roadmap ne constituent ni une architecture approuvée ni un engagement
de délai.
