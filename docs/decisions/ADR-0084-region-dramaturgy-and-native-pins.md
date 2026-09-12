---
scope:
  - .agents/skills/game-theme-author/
  - docs/templates/wallpaper-concept.schema.json
  - docs/templates/wallpaper-concept.example.json
  - docs/templates/game-theme-authoring-run.example.json
  - docs/templates/theme-interface-v5.schema.json
  - docs/architecture/theme-customization.md
  - docs/architecture/src/theme-customization.dataflow.json
  - docs/architecture/src/macos-native-wallpaper.architecture.json
  - scripts/verify-wallpaper-concept.mjs
  - pocs/macos-connector/Sources/ThemeModel/ThemeInterface.swift
  - pocs/macos-connector/Tests/ConnectorTests/ThemeInterfaceTests.swift
  - tests/theme-authoring.test.mjs
review: on-change
---
# ADR-0084 — Dramaturgie vérifiable par zone et pins natifs explicites

- Status: accepted
- Date: 2026-09-12

## Contexte

Le contrat de concept imposait une scène globale, mais pas la couverture de chacune
de ses zones. Une proposition pouvait donc être acceptée avec une région travaillée
et des régions répétitives, silencieuses ou sans activité. Le contrat de pin était
présent dans la personnalisation générique, mais restait optionnel dans l'interface v5
et absent du diagramme détaillé du connecteur macOS.

## Décision

Chaque proposition déclare un registre borné de zones et un parcours. Chaque zone
possède une identité audio sourcée, une activité principale reliée à l'inventaire,
une mise en scène et au moins trois signatures parmi silhouette, audio, acteur,
environnement et caméra. Chaque axe déclaré possède une valeur concrète et chaque
identité non silencieuse pointe une ressource audio inventoriée. Le parcours référence toutes les zones exactement une fois ;
le mode choisi déclare explicitement s'il est fermé, borné ou statique. Deux zones
adjacentes ne peuvent pas partager la même combinaison complète de signatures,
d'activité, d'audio et de mise en scène.

Une preuve reposant uniquement sur une hypothèse ne qualifie ni une zone, ni son audio,
ni son activité. Une couverture incomplète ou répétitive maintient le gate de
génération fermé. Ces champs restent génériques et ne contiennent aucun nom de jeu,
d'île, de morceau ou de créature.

L'interface v5 exige la capacité `pinning`. Le connecteur macOS possède explicitement
un coordinateur, une surface au niveau borné des fenêtres ordinaires, des hit-regions
et un état persistant par objet. L'acceptation écrit un snapshot atomique ;
l'annulation le restaure. Les surfaces sécurisées et système restent exclues, et un
pin visible invalide seulement sa région sans maintenir le wallpaper éveillé.

## Conséquences

Le plan utilisateur devient plus coûteux à documenter, mais une scène vaste ne peut
plus masquer des zones vides derrière une description générale. Un thème statique
reste possible avec une zone unique. Un thème sans support natif de fenêtre épinglée
déclare un échec de capacité et ne simule pas le pin avec une surface globale.
