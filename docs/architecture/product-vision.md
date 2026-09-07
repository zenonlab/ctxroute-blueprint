# Concepts produit

Ce schéma représente les responsabilités et relations souhaitées, pas des
services, processus, bibliothèques ou formats déjà sélectionnés.
Source : [product-vision.architecture.json](src/product-vision.architecture.json).

## Relations

Les sources de jeu alimentent un ensemble d'assets identifiables et isolés.
Un thème en compose les éléments pour habiller le bureau et le terminal.
Son sélecteur de joueurs représente les sessions de travail ; sélectionner un
joueur permet d'accéder au terminal associé.

Le thème contrôle la représentation. La session conserve l'identité du travail.
Changer l'un ne doit pas recréer l'autre. L'association entre session et
personnage est donc une relation fonctionnelle indépendante de l'apparence.
Les objets cliquables du bureau peuvent aussi être associés à des actions,
dont l'accès à une session ; ce raccourci est détaillé dans le brief.

## Portée et limites

Cette vue décrit l'expérience visible. La préparation des ressources et des
comportements est détaillée dans [la transformation du jeu](game-transformation.md).
« Assets isolés » ne résume donc pas à lui seul la bibliothèque à préparer.
Les sources et assets restent locaux : le convertisseur est séparé du runtime.
La recette distribuée ne contient pas les assets extraits ; le « thème » de
cette vue représente son résultat résolu localement, pas une archive de jeu
partageable. Voir ADR-0032 pour cette frontière de distribution.

Les trois modes — terminal, bureau, ensemble — sont des modes utilisateur.
Les boîtes ne présument ni un backend distant, ni une base de données dédiée,
ni une répartition entre applications. Le type graphique « database » de la
bibliothèque d'assets représente des données, pas un choix de stockage.

Aucune API, ABI de plugin, structure de bundle, sérialisation ou infrastructure
n'est décidée. La récupération des assets dépendra des jeux et outils retenus.
Les états internes d'un agent ne sont pas réputés observables par simple
présence de son processus dans un terminal.

## Consultation et validation

`npm run archify:validate -- all` valide les sources produit.
`npm run build:docs -- all` produit le HTML autonome.
`npm run archify:visual-check` vérifie le débordement et capture les rendus.

Artefact attendu : `dist/architecture/product-vision.architecture.html`.
Les libellés sont en français ; les contrôles du visualiseur et son attribut
de langue HTML utilisent l'anglais, langue de repli d'Archify.
Les reçus de capture automatiques laissent la revue visuelle humaine en attente.
