---
scope:
  - docs/architecture/module-contracts.md
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/src/runtime-infrastructure.architecture.json
  - docs/03-product-roadmap.md
  - docs/02-quality-strategy.md
  - docs/session-handoff.md
review: on-change
---
# ADR-0037 — Contrats sémantiques et remplacement vérifiable

- Status: accepted
- Date: 2026-09-07

## Context

La review identifie des risques de dépendance au moteur, au terminal et à la
surface native. Des modules dessinés ne prouvent pas leur indépendance. Une
preuve énergétique trop simple peut conduire à adopter un moteur inadapté.

## Decision

Formaliser C0–C6 dans module-contracts.md avec propriétaires, identités, versions,
erreurs, permissions et règles de flux. Les contrats communs ne dépendent pas des
types des bibliothèques. Le contrat privé de présentation peut coupler moteur
et adaptateur OS ; aucune interchangeabilité universelle de surface n'est promise.

Conserver sources et références durables séparées des dérivés reconstruisibles.
Déclarer les extensions spécifiques plutôt que limiter toute personnalisation
au plus petit socle commun ou prétendre à une portabilité totale des effets.
Vérifier la séparation par R01–R08 avant de la déclarer effective.

E1 examine les contraintes terminal/import et E2 teste une scène représentative
et des doubles/relations synthétiques, avant stabilisation du package en E3.
ADR-0036 conserve l'ordre des implémentations complètes ; ni ROM ni IA ne devient
un préalable à E2. Pas de deuxième moteur complet pour prouver une frontière.

## Consequences

Les interfaces publiques exécutables, codecs, bornes de messages, politiques de
tampon terminal et migrations restent à définir aux étapes concernées. Les règles
sémantiques sont décidées, leur conformité n'est pas encore testée en produit.
Pas de nouvelle dépendance, pas de code produit, dépôt toujours `template`.
Les changements de thème doivent préserver les sessions ; le remplacement à chaud
d'une technologie n'est pas une exigence acquise. Documenter le coût de sortie
de chaque choix avant adoption plutôt que promettre une réécriture sans coût.
