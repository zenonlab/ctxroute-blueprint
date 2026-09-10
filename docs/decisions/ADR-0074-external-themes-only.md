---
scope:
  - pocs/macos-connector/**
  - docs/architecture/src/macos-external-theme-runtime.dataflow.json
review: on-change
---
# ADR-0074 — Ne livrer aucun thème natif

- Status: accepted
- Date: 2026-09-10

## Décision

Le connecteur macOS ne contient aucun manifeste, asset ou catalogue de thème.

Son unique catalogue est le résultat de `ThemeDiscovery` sur les bibliothèques locales choisies par l’utilisateur. Le nom, l’identité et la recette d’un thème proviennent exclusivement de son descripteur validé `orbite-theme.json`.

Le connecteur associe la capacité `renderer` du package à un exécutable approuvé localement, puis lui transmet directement la recette et l’intention typée `--desktop`, sans shell. Le provider Apple et son catalogue de fixtures sont retirés du paquet produit.

## Conséquences

Ajouter Mario Kart, une deuxième course ou tout autre thème ne nécessite aucune modification Swift.

Un paquet absent ou invalide n’apparaît pas. Une capacité sans RenderHost approuvé échoue explicitement.

Les anciens sources et tests du provider ne participent plus au produit. L’installeur désenregistre une ancienne extension Orbite lors de la migration, sans toucher aux providers tiers.

Cette décision remplace la partie « catalogue de fixtures natives » d’ADR-0072. ADR-0073 reste la règle de résolution du RenderHost.
