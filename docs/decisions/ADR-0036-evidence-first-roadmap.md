---
scope:
  - .githooks/validate-docs.mjs
  - tests/git-architecture.test.mjs
  - docs/03-product-roadmap.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/architecture/runtime-infrastructure.md
  - docs/architecture/src/product-roadmap.workflow.json
  - docs/session-handoff.md
review: on-change
---
# ADR-0036 — Une feuille de route ordonnée par preuves

- Status: accepted
- Date: 2026-09-07

## Context

Le cadrage contient les bonnes frontières mais plusieurs ordres de discussion
historiques. L'utilisateur demande de consolider les étapes avant réalisation.
La preuve énergétique doit précéder la complexité terminal et ingestion IA.

## Decision

docs/03-product-roadmap.md devient la référence unique de progression : E1 banc
et décisions initiales, E2 wallpaper natif économe, E3 contrat de thème sécurisé,
E4 terminal et sessions, E5 qualification/distribution, E6 ingestion optionnelle.
Chaque étape a ses entrées, livrables et critères de sortie ; aucune date ni
capacité non testée n'est annoncée comme acquise. Un échec se traite au même stade.

La première preuve utilise une scène originale sans ROM. Le premier parcours
livrable est terminé en E5 ; la conversion locale et l'IA ne le conditionnent pas.
Les choix nécessaires au code expérimental doivent être consignés et les règles
d'initialisation satisfaites avant E2, sans attendre ses résultats pour s'initialiser.

## Consequences

Les anciens ordres de discussion cèdent à cette feuille de route. ADR-0035 garde
la priorité énergétique et les capacités OS qualifiées ; ADR-0034 garde le produit
thème et ses dépendances privées séparées. Aucune stack n'est adoptée ici.
Les décisions ouvertes sont rattachées à leur étape plutôt que reportées à une
« prochaine session » indéfinie. Aucun code produit ni installation dans ce changement.

Compatibilité documentaire nécessaire : le contrôle d'enveloppe accepte workflow
v2, requis pour ce nouveau schéma par Archify installé, tout en conservant v1.
Les autres types restent en v1 ; types et versions inconnus restent refusés.
La validation Archify complète reste obligatoire, sans assouplissement des contrôles
showcase. Un test couvre acceptations et rejets. Aucun câblage de session, de
coordination ou de permissions n'est modifié. Retour arrière possible par un
revert cohérent du changement de feuille de route, sans toucher aux données privées.
