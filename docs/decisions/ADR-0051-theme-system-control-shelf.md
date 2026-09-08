---
scope:
  - docs/architecture/theme-customization.md
  - docs/architecture/src/theme-customization.dataflow.json
  - docs/architecture/theme-interactions.md
  - docs/architecture/module-contracts.md
  - docs/architecture/platform-connectors.md
  - docs/architecture/ai-prepared-behaviors.md
  - docs/research/os-feasibility.md
  - docs/pocs/theme-design-poc.md
  - docs/pocs/macos-connector-poc2.md
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/03-product-roadmap.md
  - docs/session-handoff.md
  - .project/project-config.json
review: on-change
---
# ADR-0051 — Étagère de contrôles système intégrée aux thèmes

- Status: accepted
- Date: 2026-09-08

## Context

Les thèmes doivent proposer dès leur conception des contrôles cohérents avec leur
univers, notamment masquer les éléments du bureau, couper leur audio et suspendre
leurs animations. Les ajouter après génération reproduirait les panneaux incohérents
du premier PoC. Cependant, les shells de bureau n'exposent pas une API programmable
universelle et les actions globales peuvent affecter les autres applications.

## Decision

1. Ajouter à chaque starter une région sémantique `system_controls`, en haut à gauche
   par défaut, entièrement stylisable et repositionnable par le thème.
2. Fournir des comportements standard pour l'audio du thème, le mouvement, le
   verrouillage des interactions, les overlays, les profils énergétiques et les
   réglages ; le thème fournit leur présentation, pas leur implémentation privilégiée.
3. Modéliser `desktop.items.visible` comme capacité optionnelle du connecteur OS,
   appelée uniquement après action utilisateur et jamais à l'activation du thème.
4. Séparer le mute du thème du volume maître de l'OS. Le second ne fait pas partie du
   socle et exigerait une capacité intrusive et un consentement distincts.
5. Exiger une machine d'état corrélée : une requête reste `pending` jusqu'à lecture
   confirmée ; timeout, redémarrage du shell ou valeur inconnue ne valent pas succès.
6. Conserver dans l'app connecteur un chemin de récupération natif indépendant du
   thème, notamment pour réafficher les éléments du bureau.
7. Donner au générateur IA le catalogue et les invariants avant génération. Un retrait
   ou remplacement reste autorisé, mais doit être explicite et auditable.

## Consequences

Les boutons deviennent une partie native de la composition du thème et peuvent prendre
la forme d'objets, d'icônes ou d'un menu propre au jeu. Leur sémantique reste stable,
testable et portable. Une plateforme sans réglage qualifié affiche le contrôle comme
indisponible au lieu d'exécuter une commande approximative.

Le produit doit implémenter un courtier de capacités, des quittances corrélées, une
safe area et une UI de récupération. Le connecteur macOS doit remplacer le toggle
optimiste du PoC par une observation et une restauration prouvées avant promotion.
