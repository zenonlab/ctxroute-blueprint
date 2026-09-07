---
scope:
  - docs/architecture/theme-interactions.md
  - docs/architecture/module-contracts.md
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
  - docs/00-project-brief.md
  - docs/03-product-roadmap.md
  - docs/02-quality-strategy.md
review: on-change
---
# ADR-0039 — Interactions programmables entre scène et UI

- Status: accepted
- Date: 2026-09-07

## Context

Les icônes du thème sont des objets, sous-parties de géométrie ou contrôles,
distincts des icônes natives du bureau. L'utilisateur demande des liens dans
les deux sens : objets ouvrant des panneaux, boutons lançant animations/effets,
événements et états actualisant objets et UI.

## Decision

Inclure panneaux et interactions dans le périmètre du thème, indépendamment de
la présence du terminal. Les liaisons typées, références et règles s'appuient sur
C0–C2 ; sessions et PTY restent sous C3/C4, surfaces et focus sous C5. Ne pas créer
un nouveau bus de démons. Distinguer état logique, représentation visuelle et
intentions ; garder interpolations et traitements par frame dans l'hôte.

Qualifier les présentations UI en scène, superposée et native distincte sans
promettre leur équivalence par OS. Respecter priorité des entrées natives, focus
explicite, permissions, quotas et annulation. Mesurer la visibilité par surface.
Ajouter la chaîne objet→panneau→animation/effet→UI à la preuve E2, avant adoption
du backend ; détailler les contrats exécutables en E3.

## Consequences

Le produit dépasse un fond animé à raccourcis, sans devenir un moteur de jeu
complet obligatoire. Il faut évaluer layout, widgets, texte/IME, accessibilité
et composition avec le rendu dans le choix des briques UI.
Pas de framework ni langage de thème adopté ; pas de promesse « tout effet sur
tout OS ». Les tests I01–I10 sont prévus, sans implémentation produit.
Les références et créations de thème restent séparées des assets privés extraits.
L'énergie reste prioritaire : pas de boucle ni de traitement actif sans nécessité.
