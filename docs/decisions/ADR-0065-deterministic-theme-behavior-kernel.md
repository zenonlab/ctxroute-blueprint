---
scope:
  - docs/architecture/ai-prepared-behaviors.md
  - docs/architecture/module-contracts.md
  - docs/architecture/game-transformation.md
  - docs/architecture/theme-interactions.md
  - docs/architecture/src/game-transformation.architecture.json
  - docs/pocs/theme-design-poc.md
  - docs/02-quality-strategy.md
review: on-change
revised: true
---
# ADR-0065 — Noyau déterministe de comportements et directeur caméra

- Status: accepted
- Date: 2026-09-09

## Context

Les thèmes doivent pouvoir faire boucler de nombreuses entités sur de vraies
trajectoires, conserver une formation liée aux sessions et cadrer proprement le groupe.
Réutiliser la boucle complète du jeu source chargerait des systèmes inutiles et
rendrait chaque thème dépendant d'un émulateur. Confier les décisions par frame à un
modèle serait non déterministe, coûteux et impossible à utiliser hors ligne.

## Decision

1. Introduire un petit noyau comportemental source-neutre, séparé de l'hôte de rendu.
2. Exécuter les contrôleurs sur un pas fixe et publier des snapshots interpolables ;
   la cadence d'affichage ne modifie pas le résultat logique.
3. Fournir des primitives activées à la demande : état d'entité, chemin, formation,
   graphe d'actions, récupération et directeur caméra.
4. Garantir une autorité unique par transformation. Toute prise de contrôle temporaire
   est arbitrée et rendue explicitement.
5. Préparer les chemins bouclés avec longueur cumulée, branche, enveloppe et continuité
   de raccord. Une liste de points brute ne suffit pas à qualifier une course.
6. Cadrer le groupe depuis ses ancres, le ratio d'écran et la safe area, avec bornes
   et lissage. La caméra ne corrige jamais la trajectoire des entités.
7. En cas de cadrage impossible, utiliser un fallback déclaré au lieu de déformer la
   simulation : autre rig, zoom borné, limite d'instances ou pagination.
8. Réserver l'IA à la préparation hors ligne. Elle configure ou génère un contrôleur
   puis des tests et traces reproductibles ; aucun modèle n'entre dans la boucle.
9. Charger uniquement les capacités requises par la composition et suspendre leur
   horloge lorsqu'elles ne sont plus utiles ou visibles.

## Consequences

Un thème de course peut présenter plusieurs karts réellement orientés dans les
virages, conserver leur place et réinsérer un kart sans exécuter les bots originaux.
Le même noyau couvre une patrouille 2D, un groupe 3D ou une scène custom dès que
l'adaptateur produit les données canoniques nécessaires.

La promesse reste conditionnelle aux capacités extraites et validées. Les contrôleurs
complexes demandent des fixtures, invariants et mesures. Bevy peut héberger la première
preuve, mais ses types, son ECS et son renderer ne deviennent pas le contrat public.

## Implementation evidence

`pocs/theme-behavior-kernel` matérialise la première frontière sans renderer : fixture
JSON originale, piste fermée compilée, pas fixe, huit instances/session, formation,
directeur caméra et snapshots sérialisables. Les tests couvrent le raccord, deux tours,
2 000 pas déterministes, la safe area et la reprise bornée. Cette preuve ne change pas
la décision et ne qualifie pas encore le raccord Bevy ou wallpaper.
