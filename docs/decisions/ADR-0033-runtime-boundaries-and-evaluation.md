---
scope:
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
  - docs/research/console-coverage.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/session-handoff.md
  - docs/architecture/README.md
  - docs/document-contracts.json
  - .project/project-config.json
  - README.md
review: on-change
---
# ADR-0033 — Frontières runtime et évaluation des composants existants

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur demande une infrastructure rangée par responsabilité et un
inventaire de consoles plus large qu'un échantillon. Le projet impose conversion
locale séparée, réutilisation de l'existant et faible coût permanent.

## Decision

Documenter des responsabilités distinctes : ingestion, adaptateurs de formats
et de jeux, bibliothèque, préparation de composition, contrôle/permissions,
sessions, interface terminal, hôte de scène et intégration desktop par OS.
Ne pas traduire automatiquement ces modules en autant de processus.
Les connaissances spécifiques aux consoles/jeux restent dans les adaptateurs ;
la compatibilité est qualifiée par jeu/version/capacité et preuve, pas par le
seul nom d'un émulateur. Aucun système n'est encore certifié dans notre produit.

Privilégier un banc d'essai réutilisant Rust/Tauri/xterm.js/portable-pty pour
contrôle et terminal, et Godot pour l'hôte de scène. C'est une recommandation
d'évaluation, **pas une adoption des dépendances**. L'ancrage natif du moteur,
la personnalisation, la sécurité et la consommation sont des preuves bloquantes.
La matrice d'alternatives reste dans le document d'infrastructure ; ne pas
développer simultanément plusieurs moteurs pour comparer leurs noms.

## Alternatives

WezTerm étendu pourrait réduire le code si l'interface convient. Un rendu web
pourrait faciliter l'intégration mais doit passer les budgets. Un moteur wgpu
spécifique serait plus contrôlable mais demanderait davantage de code ; ne le
retenir qu'après identification des insuffisances concrètes de l'existant.
Un émulateur permanent et une infrastructure cloud sont hors du parcours retenu.

## Consequences

Deux vues complémentaires : conversion locale et runtime modulaire. Les docs
de recherche recensent les systèmes et les limites, sans badges de support
inventés. Les futurs dossiers sont décrits, pas créés à vide ; le blueprint
existant n'est pas déplacé. Aucun code produit ni initialisation dans cette étape.

Il reste à choisir l'OS de première preuve, le matériel, les versions des outils,
la politique locale de conservation et les seuils de performance. Le PoC OoT
reste nécessaire à l'adoption du pipeline, mais n'empêche pas d'étudier le
terminal et une scène synthétique sans ROM.
