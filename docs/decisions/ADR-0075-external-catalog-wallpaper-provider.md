---
scope:
  - pocs/macos-connector/**
  - docs/architecture/src/macos-external-theme-runtime.dataflow.json
review: on-change
---
# ADR-0075 — Exposer le catalogue externe dans Réglages macOS

- Status: accepted
- Date: 2026-09-10

## Décision

Le paquet macOS contient une unique extension `WallpaperProvider.appex` enregistrée auprès du point d’extension privé `com.apple.wallpaper`.

L’extension ne contient aucun thème, manifeste ou asset de thème. Elle demande à l’agent Swift signé le catalogue produit par `ThemeDiscovery`, puis construit les modèles de Réglages à partir des seules identités et libellés validés. Une vignette Orbite générique est générée localement par l’extension.

Quand macOS acquiert un choix, l’extension transmet une intention d’activation typée et bornée à l’agent. L’agent résout l’identité contre sa découverte courante, résout la capacité `renderer` contre le registre approuvé, puis lance directement le RenderHost sans shell. L’extension fournit à macOS une surface transparente de cycle de vie ; le rendu réel reste la fenêtre desktop du RenderHost sous les icônes Finder.

Le canal XPC limite les messages, vérifie l’UID et épingle les exigences de signature de l’agent et de l’extension. Un identifiant absent du catalogue courant ne peut pas activer un processus.

## Conséquences

Un utilisateur lance Orbite une première fois pour ajouter sa bibliothèque et approuver le RenderHost, puis choisit son thème dans Réglages Système > Fond d’écran.

Cette intégration dépend d’une API privée de macOS 26 et d’une signature locale stable. Elle est expérimentale, non distribuable sur le Mac App Store et doit être requalifiée à chaque version de macOS.

Cette décision remplace uniquement le retrait du provider décidé par ADR-0074. L’interdiction d’embarquer des thèmes et la résolution par capacité d’ADR-0073 restent inchangées.
