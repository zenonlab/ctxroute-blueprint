---
scope:
  - docs/research/oot-environment-pilot.md
  - docs/architecture/game-transformation.md
  - docs/architecture/src/game-transformation.architecture.json
review: on-change
---
# ADR-0040 — Moteur source et interactivité du thème

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur souhaite réutiliser un jeu comme environnement interactif, en
s'appuyant sur les outils existants plutôt que réinventer son moteur. Les
preuves communautaires ne doivent pas être confondues avec la qualification
de notre normalisation, de l'ancrage desktop ou de l'énergie.

## Decision

Étudier OoT/Temple du Temps comme cas provisoire, sans imposer ce jeu à
l'utilisateur ni au cœur. Documenter révisions, ressources décrites, liens,
pertes connues et travail restant avant d'adopter une chaîne.

Le moteur source détermine l'adaptateur ; notre runtime exécute les interactions
du thème. Distinguer données récupérées, comportement original porté, adaptation
créée et capacité absente. Aucun comportement du jeu n'est déclaré récupéré à
partir d'un simple mesh ou clip. Aucun port complet du jeu en arrière-plan.

Conserver recette partageable et bibliothèque privée séparées. Les dépendances
comprises du comportement source restent traçables ; les exemples ne deviennent
pas des exceptions dans C0–C6. La découverte publique peut avoir lieu maintenant ;
elle ne modifie pas l'ordre E1–E6 ni les prérequis avant code produit.

## Consequences

Le chemin historique « ZAPD puis glTF » reste une hypothèse, pas une intégration
acquise. L'étude identifie une extraction Python dans OoT et Torch dans Shipwright.
Normalisation, effets dynamiques, audio séquencé et contrôleur du joueur requièrent
des preuves distinctes. La recherche ne certifie aucune entrée utilisateur.

Pas de dépendance installée ou adoptée. L'extraction effective attend une entrée
locale fournie et une isolation qualifiée. Un premier panneau interactif ne
requiert pas de porter marche, saut, sauvegarde ou cinématiques du jeu original.
