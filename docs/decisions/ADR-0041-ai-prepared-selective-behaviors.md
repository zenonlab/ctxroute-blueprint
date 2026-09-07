---
scope:
  - docs/architecture/ai-prepared-behaviors.md
  - docs/architecture/game-transformation.md
  - docs/architecture/module-contracts.md
  - docs/architecture/theme-interactions.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/00-project-brief.md
review: on-change
---
# ADR-0041 — Comportements sélectifs préparés par IA

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur veut des environnements issus de jeux 2D, 3D ou custom ; l'IA
prépare les liens et adaptations. Son exemple de course exige des véhicules
qui tournent réellement et restent en formation, pas des icônes fixes.
Reprendre tous les bots contredit souvent la formation stable et la sobriété.

## Decision

Retenir données originales utiles et contrôleurs adaptés comme voie prioritaire.
Portage/recompilation d'une logique originale possible si ses dépendances,
droits, isolation et budget sont qualifiés. Aucun jeu ou émulateur complet
nécessaire au fonctionnement permanent ; aucune IA dans la boucle de rendu.

La préparation produit un résultat reproductible : adaptateur, références,
contrôleurs, liaisons et preuves. Utiliser C0–C6, pas un nouveau bus ou un DSL
capable par hypothèse de représenter tous les moteurs. Extension explicite pour
une capacité manquante, non simple clé générée et acceptée sans implémentation.

Les entrées comprennent ROM, fichiers et projets disponibles ; la représentation
2D n'est pas forcée en 3D. Le cœur reste indépendant des noms de jeux.
OoT demeure un exemple de recherche, pas une condition préalable universelle.

## Consequences

La configuration demandée à l'utilisateur est simplifiée ; l'incertitude du
reverse engineering ne disparaît pas. Aucune conversion automatique universelle
garantie. Les replis fonctionnels sont explicites, jamais un appauvrissement caché.

Course : trajectoire réelle et formation contrôlée, sauvetage visuel séparé de
la reprise effective d'une session. État inconnu et erreur persistante conservés.
Provenance et données privées restent séparées des créations partageables.

Pas de stack ni de langage supplémentaire adopté, pas de code produit ici.
Les tests A01–A08 complètent E1–E6 sans modifier leurs prérequis.
