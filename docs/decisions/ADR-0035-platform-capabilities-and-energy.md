---
scope:
  - docs/00-project-brief.md
  - docs/02-quality-strategy.md
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
  - docs/session-handoff.md
review: on-change
---
# ADR-0035 — Qualification par environnement et priorité énergétique

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur place la consommation minimale du wallpaper avant la liberté
d'effets et demande une compatibilité tous OS. Il accepte de documenter une
matrice de fonctionnalités avant le choix final de la stack.

## Decision

Viser Windows, macOS et Linux avec contrats de thème communs et adaptateurs
desktop distincts. Qualifier GNOME Wayland, KDE Wayland, Sway et X11 séparément.
Aucune promesse « 100 % tous OS ». Chaque fonction a ses preuves, limites et
replis ; prévisualisation en fenêtre ne signifie pas support wallpaper.

Une capacité absente/inconnue ou une permission refusée désactive la fonction
concernée sans casser les sessions ni contourner les protections du système.
Le budget énergétique prime sur une parité obtenue par scrutation permanente.
Mesurer énergie et coûts incrémentaux sur des configurations identifiées avant
de fixer les chiffres de support ; ne pas confondre fréquence et efficacité.

## Consequences

La matrice et son protocole de preuve vivent dans runtime-infrastructure.md.
Versions minimales, matériels, dépendances et ordre des PoC restent ouverts.
Rust/wgpu natif est une recommandation à éprouver, pas une adoption ni une
supériorité énergétique démontrée. ADR-0034 reste applicable à la séparation
des données privées et des thèmes, ainsi qu'à la préparation à la demande.
Le projet reste `template`, sans code produit ni certification de plateforme.
