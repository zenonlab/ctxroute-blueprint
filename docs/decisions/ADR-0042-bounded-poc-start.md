---
scope:
  - docs/05-poc-start-plan.md
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/03-product-roadmap.md
  - docs/04-experimental-protocol.md
  - docs/architecture/src/product-roadmap.workflow.json
review: on-change
---
# ADR-0042 — Démarrer des PoCs bornés avant adoption

- Status: accepted
- Date: 2026-09-07

## Context

Le cadrage répétait les questions ouvertes sans fixer le premier essai.
L'utilisateur demande des corrections permettant de commencer les PoCs.
Les preuves documentaires ne démontrent ni consommation, ni ancrage interactif,
ni conversion universelle. Le dépôt n'est pas encore initialisé pour du code produit.

## Decision

Fixer le périmètre expérimental L1–L3 du plan de démarrage : sonde native macOS
Swift/AppKit indépendante, contrôleur Rust sans GPU, puis scène Rust/wgpu/WGSL.
Pas de pont FFI entre les deux prototypes, ni stack Swift de production imposée.
Versions exactes et commandes validées à l'installation du PoC concerné.

Utiliser fixtures originales et états simulés, contrôleurs compilés relus,
données bornées, aucune exécution tierce ou action système. Reporter terminal
réel, import privé et préparation IA à leurs étapes existantes.

Séparer résultats fonctionnels et verdict énergétique. Une baseline exploratoire
peut précéder le gel des budgets comparatifs ; elle ne clôt pas E2. Maintenir
les obligations d'initialisation avant code. Pas de sélection définitive du moteur,
de suppression des interactions riches ou de promesse tous jeux/tous OS.

## Consequences

Les choix nécessaires au départ ne sont plus reportés à une discussion générale.
Le premier code doit vérifier l'OS avant d'investir dans le rendu. Chaque essai
réduit une incertitude distincte ; un test en fenêtre ne certifie pas le desktop.

La sonde native ajoute un petit code de diagnostic indépendant ; ne pas en faire
une seconde implémentation complète du produit. E3 pourra remplacer le format de
fixture interne sans migration publique. Aucun PoC exécuté par cet ADR.
