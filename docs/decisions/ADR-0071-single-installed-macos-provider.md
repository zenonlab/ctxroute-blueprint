---
scope:
  - pocs/macos-connector/**
  - docs/architecture/src/macos-native-wallpaper.architecture.json
  - docs/pocs/macos-connector-poc2.md
review: on-change
---
# ADR-0071 — Un seul provider macOS enregistré

- Status: accepted
- Date: 2026-09-10

## Decision

Le build Swift produit un paquet signé sous `dist/` sans enregistrer son `.appex`.
Le test du catalogue Apple utilise un bundle de ressources neutre et temporaire,
jamais une App Extension. Seul `install.sh` enregistre la copie canonique placée
sous `~/Applications/Wallpaper Themes/` et refuse de conclure tant que PlugInKit
ne retourne pas exactement ce chemin. Les hôtes de build associés à une ancienne
inscription sont aussi retirés de LaunchServices, faute de quoi macOS peut reconstruire
l'inscription du `.appex` lors de la prochaine ouverture des Réglages.

Un thème ne référence plus un asset absent. Le fond privé facultatif est validé,
copié dans le paquet et ajouté uniquement au manifeste staged. La version du paquet
et de l'extension passe à 0.3.0, build 5.

## Consequences

Construire ou tester ne pollue plus le catalogue macOS. Une ancienne copie reste
sauvegardée sous `dist/` lors d'une installation, mais n'est pas enregistrée.
L'utilisation d'une API wallpaper Apple privée demeure une limite du PoC.
