---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/game-transformation.md
  - docs/architecture/product-vision.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/session-handoff.md
review: on-change
---
# ADR-0032 — Conversion locale séparée et recettes sans assets de jeu

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur veut que chacun puisse utiliser les systèmes terminal/wallpaper
et thèmes distribués, mais fournisse sa ROM et effectue lui-même la conversion
avec un moyen séparé. Il demande de ne rien enregistrer côté fournisseur.

## Decision

Séparer application, recettes partageables et convertisseur hors ligne.
L'utilisateur lance ce dernier localement avec sa propre entrée. Réutiliser
les extracteurs/décompilateurs existants via adaptateurs ; aucune conversion
universelle n'est promise. Les recettes distribuées référencent les ressources
attendues sans contenir ROM, assets ou code extraits des jeux.

Le runtime résout ces références dans la bibliothèque locale et n'exécute
ni le jeu complet, ni un émulateur, ni un convertisseur en permanence.
Sans ressources compatibles, un thème dépendant du jeu est indisponible avec
diagnostic ; le terminal et les thèmes indépendants d'une ROM restent utilisables.

Le parcours de conversion ne transmet pas de données du jeu à nos services
ou à une IA distante. La bibliothèque persistante locale d'ADR-0031 reste
l'hypothèse de travail ; les modalités de conservation/purge ne sont pas
encore confirmées. « Aucune collecte chez nous » ne signifie pas « aucun fichier
sur le disque utilisateur ». Cette ambiguïté est conservée explicitement.

## Consequences

Prévoir résolution/versionnement, rapports de capacités, export de recettes
séparé des résultats privés et autorisations des actions système. Vérifier
les licences des dépendances et des éléments publiés avant distribution ;
cette décision ne constitue pas une validation juridique des usages.

Le packaging, la stack, la sandbox et les contrats restent ouverts.
Les émulateurs évoqués sont des candidats d'observation/validation hors ligne,
pas une liste de jeux convertibles ni des dépendances adoptées.
Aucun produit n'est implémenté ; le dépôt reste au statut template.
