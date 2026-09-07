---
scope:
  - pocs/macos-native-wallpaper/**
  - docs/pocs/macos-native-wallpaper.md
  - docs/architecture/src/macos-native-wallpaper.architecture.json
  - .project/project-config.json
review: on-change
revised: true
---
# ADR-0047 — Qualification isolée du wallpaper natif Apple

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur refuse un fond implémenté comme fenêtre superposée. ADR-0043–0046
restent des expériences historiques, pas la solution demandée. Phosphene déclare
le point d'extension `com.apple.wallpaper` et implémente les échanges XPC privés
avec WallpaperAgent. Son ColorDiag fournit une animation Core Animation existante.

## Decision

Préparer un essai indépendant sous `pocs/macos-native-wallpaper/`, à partir de
Phosphene MIT révision `8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6`.
Conserver l'amont intact et appliquer les adaptations de diagnostic uniquement
à une copie de build. Ne pas incorporer l'application hôte complète ni
ses outils de mise à jour au runtime du projet.

La préparation ne lance aucune extension, n'écrit pas dans son conteneur utilisateur,
ne change pas le fond système et ne redémarre aucun service Apple. Compiler et
inspecter un binaire ne prouve ni son admission par macOS, ni ses transitions.
La sélection réelle dans les réglages reste une étape de qualification distincte.
Ne pas présenter l'absence de certificat local comme preuve que toute signature
ad hoc serait impossible ; son admission n'est simplement pas établie.

## Consequences

Le framework et CAContext sont privés : cette voie ne garantit ni stabilité
inter-version ni distribution App Store. ColorDiag ne valide ni clics, ni panels,
ni glTF/Metal/wgpu. Aucun callback souris n'est défini dans le protocole XPC amont
inspecté ; aucune conclusion universelle d'impossibilité n'en découle.
Le build natif et sa validation sont séparés de la CI documentaire Node.
Un éventuel lancement exige revue du code exécuté, identité de bundle isolée,
signature admissible et procédure de retour au fond antérieur.

## Extension du test — paquet local

Après demande utilisateur de préparer un test, `prepare.sh --package` assemble
une application hôte AppKit minimale et son extension dans `Contents/Extensions`.
Identités `org.wallpaperthemes.nativeprobe` et `.extension`, signature ad hoc
locale vérifiée, sandbox activée pour l'extension sans droit réseau ajouté.
L'enregistrement explicite par `pluginkit -a` est autorisé pour cette qualification ;
il ne vaut pas sélection d'un fond ni admission effective par WallpaperAgent.
Le fond est sélectionné manuellement par l'utilisateur, qui revient à son ancien
fond dans Réglages pour arrêter l'essai. Pas de désactivation SIP/Gatekeeper.

Le build exclut VideoLibrary et SpiralRecovery amont, remplacés par une seule
entrée diagnostic en mémoire et des opérations inertes. Le patch de copie retire
l'ouverture de l'application amont et remplace les noms de notifications par
l'espace de nom propre. Les échecs d'identification des appelants XPC deviennent
des refus. Les échanges privés et leur rendu restent des hypothèses à tester.

Source : [Phosphene épinglé](https://github.com/kageroumado/phosphene/tree/8b5bd57c1450eda74cf2ec6ceaae2e586cfdfcd6).
