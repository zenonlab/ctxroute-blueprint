---
scope:
  - pocs/macos-connector/
  - docs/architecture/src/theme-customization.dataflow.json
review: on-change
revised: true
---
# ADR-0078 — Contrôles superposés du mix de thème

- Status: accepted
- Date: 2026-09-11

## Context

La première étagère associait des pictogrammes de course sans rapport direct avec
leur action et réduisait l'audio à un bouton muet. Le thème demandé doit présenter
une commande compacte et lisible sans dépendre d'icônes système ou d'un nom de jeu
codé dans le connecteur.

## Decision

`orbite.theme-interface/2` décrit deux lignes de deux composants : un orbe audio et
sa barre, puis un orbe de luminosité et sa barre. La première barre règle le volume
audio global du thème, musique et effets ensemble ; la seconde règle sa luminosité.
Les deux valeurs sont absolues,
finies et bornées entre zéro et un. Elles ne modifient jamais le volume matériel ni
la luminosité physique du Mac.

Le package fournit les images des rôles `theme.audio`, `display.brightness`,
`slider.track` et `slider.thumb`. Un package v2 incomplet
est refusé ; le connecteur ne remplace aucune image absente par un SF Symbol. Le
thème Mario Kart utilise uniquement des dérivés privés de sa ROM, vérifiés par
empreinte et conservés hors Git.

Le message Swift vers le RenderHost passe en schéma 2 et transporte
`audio_volume`, `brightness` et `visual_paused`. Le RenderHost arrête son horloge
de simulation lorsqu'il est en pause et écarte le premier delta à la reprise. La
La visibilité Finder reste une capacité macOS séparée et réversible dans l'interface
native ; la pause reste un état du protocole mais ne prend plus de place dans cette
shelf compacte. Un manifeste v1
doit être migré explicitement : le connecteur ne lui invente ni icône ni commande.

## Consequences

La présentation actuelle contient exactement quatre composants, tout en restant
remplaçable par un autre jeu. Un renderer sans piste audio peut mémoriser le volume
sans prétendre produire du son. La pause est indépendante de l'occlusion : les deux
causes arrêtent l'animation, mais seule une reprise explicite annule la pause choisie
par l'utilisateur.
