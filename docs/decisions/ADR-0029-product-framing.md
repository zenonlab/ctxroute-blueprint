---
scope:
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/product-vision.md
  - docs/architecture/src/product-vision.architecture.json
  - docs/research/initial-research.md
  - docs/session-handoff.md
  - docs/document-contracts.json
  - .project/project-config.json
review: on-change
---
# ADR-0029 — Cadrage produit et report des choix techniques

- Status: accepted
- Date: 2026-09-07

## Context

La recherche initiale proposait un moteur de fond d'écran diégétique et une
ingestion ROM. L'utilisateur étend la vision à un terminal personnalisé :
les sessions de shells et d'agents deviennent des joueurs sélectionnables,
avec Mario Kart comme exemple. Il confirme les trois OS, la modularité et
l'isolation des éléments de jeu. Il demande de privilégier l'existant et de
reporter la discussion technique à une autre session.

## Decision

Adopter une expérience cohérente avec terminal seul, bureau seul et ensemble
intégré. Séparer conceptuellement la session de sa représentation visuelle ;
changer de personnage ou de thème conserve le travail.
Viser Linux, macOS et Windows, avec couverture exacte à démontrer.

Installer CTXRoute Blueprint comme outillage local. Documenter le produit
sans choisir sa stack, son packaging ni ses contrats techniques.
Conserver le statut `template` : la découverte est engagée, l'initialisation
technique est volontairement incomplète.

Privilégier adoption, extension et assemblage de composants existants.
Archiver les propositions initiales comme hypothèses et non comme décisions.

## Alternatives

Le fond d'écran seul correspondait à la recherche initiale mais ne couvre plus
la demande. Un ensemble monolithique obligatoire ne satisfait pas les modes
séparés. La sélection immédiate de Rust/wgpu et d'un format universel anticipe
la discussion explicitement reportée par l'utilisateur.

## Consequences

La prochaine session doit commencer par comparer l'existant au besoin produit.
Aucun jeu pilote ni délai de livraison n'est fixé. La récupération de toutes
les données de tous les jeux n'est pas une capacité acquise.
Les ADR du blueprint restent des décisions d'outillage ; ils ne prescrivent pas
la stack du terminal ou du moteur desktop.
