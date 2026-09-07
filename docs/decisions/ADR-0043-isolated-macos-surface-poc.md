---
scope:
  - pocs/macos-surface/**
  - .project/project-config.json
  - docs/architecture/src/macos-surface-poc.architecture.json
  - docs/pocs/macos-surface.md
  - docs/00-project-brief.md
  - docs/02-quality-strategy.md
  - docs/document-contracts.json
  - tests/hooks.test.mjs
review: on-change
---
# ADR-0043 — Sonde macOS isolée et initialisation expérimentale

- Status: accepted
- Date: 2026-09-07

## Context

L'utilisateur autorise L1 en demandant une isolation nette. ADR-0042 définit le
périmètre ; le statut template ne doit plus reporter indéfiniment sa réalisation.

## Decision

Initialiser seulement ce périmètre via `npm run initialize`. Conserver les guides
historiques, sans supprimer de fichier ni changer les hooks. Installer le PoC dans
`pocs/macos-surface/`, hors des workspaces npm et du futur runtime Rust.

SwiftPM sans dépendance tierce : bibliothèque Foundation pour état/configuration,
exécutable AppKit et tests XCTest. Swift 6, compilateur local 6.3.2 et SDK macOS
26.5 ; cible de compilation macOS 14, qualification limitée à MAC-01 (26.2).
Le lanceur sélectionne le SDK par xcrun pour son processus, sans modifier Xcode.

Deux modes exclusifs : fenêtre interactive et bureau passif. Ce dernier ignore
toutes les entrées, ne devient ni key ni main window et n'active pas l'application.
Durée finie obligatoire (défaut 60 secondes, maximum 600). Aucun service résident,
import externe, commande shell depuis le binaire, réseau, ROM ou session réelle.
Avec le lanceur, les builds et captures restent sous `dist/pocs/macos-surface/` ;
aucune suppression. Une invocation directe du binaire écrit sa capture optionnelle
dans son répertoire courant. Les caches système du compilateur ne sont pas confinés.

L'état est distinct de l'UI et du dessin. L'animation est locale, plafonnée et
suspendue sans timer répétitif lors d'une pause ou invisibilité AppKit déclarée.
La visibilité reste un signal AppKit, pas une preuve d'occlusion parfaite.
Un smoke automatisé appelle les contrôles de l'application : il ne prouve pas le
routage de vrais clics Finder. Compteurs de dessin et ticks ne sont pas des watts.

## Consequences

L'isolation est organisationnelle et par processus, pas une sandbox de code hostile.
Le programme compilé garde les droits usuels du compte ; ne charger aucun code tiers.
Le test peut être compilé/lancé indépendamment de Node/npm. Il ne sélectionne ni
la stack terminal ni la stack de production multiplateforme.

Sensor reconnaît Swift sans parseur qualifié : conserver ce diagnostic explicite,
utiliser compilation avec avertissements bloquants, XCTest et review des accès.
Les tests macOS sont un gate local séparé ; la CI blueprint ne les certifie pas.

Correction préalable : le test de refus d'initialisation opérait sur le dépôt réel
et pouvait lancer une validation récursive puis changer son statut. Il utilise
désormais une fixture temporaire incomplète et vérifie les octets du dépôt réel.
Le test du hook distingue silence en template et rappel borné des seuls ADR
applicables à une modification après initialisation. Il ne confond plus ce rappel
avec une injection automatique CTXRoute. Aucun hook runtime n'est modifié.
