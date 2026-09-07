---
scope:
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/00-project-brief.md
  - docs/01-technology-decisions.md
  - docs/02-quality-strategy.md
  - docs/session-handoff.md
review: on-change
---
# ADR-0031 — Bibliothèque canonique, capacités et diorama ambiant

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur confirme la séparation entre conservation des données du jeu et
exploitation par le diorama. Les questions produit d'ADR-0030 sont affinées sans
fixer de stack ni affirmer une conversion universelle déjà possible.

## Decision

Indexer globalement le jeu et matérialiser progressivement ses scènes avec les
ressources partagées. Conserver les informations effectivement récupérées et
leur provenance sans suppression volontaire. La déduplication préserve les
identités logiques. Les simplifications sont des dérivés de composition ; leur
préparation hors ligne est autorisée sans altérer la bibliothèque canonique.

Adopter le diorama ambiant, réactif et cliquable comme mode principal, avec
comportements adaptés et contrôle direct optionnel explicite. Les modes
terminal seul, bureau seul et intégrés restent inchangés.

Conditionner les fonctionnalités aux capacités validées et signaler les
approximations. Une AABB de picking ne remplace pas la navigation. Une boucle
audio ou une fidélité visuelle exacte doivent être démontrées, pas seulement
déclarées par des tags ou un format.

Retenir les profils économie, bureau fluide et haute fréquence expérimentale
comme politiques cibles soumises à mesures. OoT devient candidat prioritaire
pour un PoC de scène complet ; la sélection définitive des outils et du jeu
pilote dépend des preuves d'extraction et de conservation des relations.

## Consequences

Cet ADR résout le choix du mode nominal et de la conversion progressive laissés
ouverts par ADR-0030 ; il ne remplace pas ses frontières d'infrastructure.
Les structures du manifeste, noms de commandes et formats illustrés ne sont pas
encore des API adoptées. La ROM/version, la scène précise, le matériel de mesure,
les limites thermiques et l'audio au repos restent à préciser.
Le projet reste `template` ; aucun PoC n'est déclaré exécuté.
