---
scope:
  - pocs/macos-connector/**
  - docs/architecture/src/macos-external-theme-runtime.dataflow.json
review: on-change
revised: true
---
# ADR-0075 — Exposer le catalogue externe dans Réglages macOS

- Status: accepted
- Date: 2026-09-10

## Décision

Le paquet macOS contient une unique extension `WallpaperProvider.appex` enregistrée auprès du point d’extension privé `com.apple.wallpaper`.

L’extension ne contient aucun thème, manifeste ou asset de thème. Elle demande à l’agent Swift signé le catalogue produit par `ThemeDiscovery`, puis construit les modèles de Réglages à partir des identités, libellés et URLs de covers validés. La cover PNG optionnelle reste dans le package externe et son URL figure dans les fichiers du choix afin que macOS gère l’accès ; une vignette Orbite générique est générée localement uniquement en fallback.

Tant que l’hôte Apple est connecté, l’extension relit périodiquement le catalogue et appelle `updateSettingsViewModels` seulement si sa valeur change. Le panneau reçoit donc les ajouts, retraits, libellés et covers sans redémarrage global. Une réinstallation binaire termine exclusivement l’ancien exécutable `WallpaperProvider` situé dans l’app Orbite installée ; elle ne tue ni Réglages, ni WallpaperAgent, ni un provider tiers.

Quand macOS acquiert un choix, l’extension transmet une intention d’activation typée et bornée à l’agent. L’agent résout l’identité contre sa découverte courante, résout la capacité `renderer` contre le registre approuvé, puis lance directement le RenderHost sans shell. L’extension fournit à macOS une surface transparente de cycle de vie ; le rendu réel reste la fenêtre desktop du RenderHost sous les icônes Finder.

Le canal XPC limite le nombre d’items, la forme et la longueur des URLs locales et le message encodé ; il vérifie l’UID et épingle les exigences de signature de l’agent et de l’extension. Un identifiant absent du catalogue courant ne peut pas activer un processus.

## Conséquences

Un utilisateur lance Orbite une première fois pour ajouter sa bibliothèque et approuver le RenderHost, puis choisit son thème dans Réglages Système > Fond d’écran.

Cette intégration dépend d’une API privée de macOS 26 et d’une signature locale stable. Elle est expérimentale, non distribuable sur le Mac App Store et doit être requalifiée à chaque version de macOS.

Cette décision remplace uniquement le retrait du provider décidé par ADR-0074. L’interdiction d’embarquer des thèmes et la résolution par capacité d’ADR-0073 restent inchangées.
