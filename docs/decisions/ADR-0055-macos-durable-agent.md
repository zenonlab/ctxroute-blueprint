---
scope:
  - pocs/macos-connector/**
  - docs/architecture/platform-connectors.md
  - docs/architecture/src/platform-connectors.architecture.json
  - docs/session-handoff.md
  - .project/project-config.json
review: on-change
---
# ADR-0055 — Démarrage supervisé et identité locale stable

- Status: accepted
- Date: 2026-09-08

## Context

Les reconstructions ad hoc changent l'exigence de signature de l'agent ; une case
Accessibilité cochée pour l'ancien code ne qualifie pas le nouveau. Le job précédent
était éphémère. Un lancement LaunchServices transitoire du même bundle pouvait aussi
être confondu avec un second agent et provoquer une sortie normale prématurée.

## Decision

`start-agent.sh --persistent` inscrit un seul job Aqua utilisateur dans
`~/Library/LaunchAgents/org.wallpaperthemes.connectorpoc2.agent.plist`. RunAtLoad
assure la demande au login ; KeepAlive/SuccessfulExit=false reprend après une sortie
anormale, avec ThrottleInterval=10. Pas de supervision active par boucle applicative.
Une seconde demande start conserve le PID si la configuration est identique.
Les chemins étrangers et liens symboliques de configuration sont refusés ; les
anciennes configurations sont conservées. Restart conserve le choix persistant.
Quitter décharge le job pour la session ; la prochaine connexion le recharge.
L'ouverture manuelle du lanceur recharge aussi le plist persistant, après validation
du chemin de l'exécutable, du service Mach, des arguments et des clés permises.

Le lancement de l'agent passe par launchd. Le marqueur XPC_SERVICE_NAME contrôle
ce chemin d'exécution, pas l'identité d'un pair ni une frontière de sécurité.
Le contrôle des pairs demeure la signature XPC existante. Le smoke isolé reste
explicite. Aucun lancement direct depuis un terminal ne qualifie TCC.

Après accord utilisateur, une identité locale dédiée est créée dans le trousseau.
La confiance est limitée à la signature de code, sans confiance TLS et sans compte
Apple payant. `build.sh --sign-local SHA1` exige cette identité valide et n'utilise
jamais ad hoc comme repli. Aucun requirement réduit au seul bundle ID n'est ajouté.
Une migration vers cette identité nécessite une nouvelle autorisation TCC ; sa
persistance entre versions doit être mesurée, pas déduite du seul certificat.
Ce certificat local ne permet ni notarisation ni distribution Developer ID.

L'installateur refuse par défaut un agent qui ne satisfait pas l'exigence de
l'agent installé. `--allow-identity-change` rend une migration volontaire explicite,
sans accorder de permission. Le préflight conserve le refus d'un provider actif.

## Validation et limites

Tester deux codes différents avec la même identité et vérifier leurs requirements,
deux starts sans changement de PID, reprise après arrêt anormal, quittance XPC,
TCC dans le job launchd et les gestes natifs. Une simple présence de processus ne
prouve ni l'autorisation ni le fonctionnement du wallpaper. Le login réel reste
une épreuve séparée ; aucun logout/reboot utilisateur n'est déclenché par les tests.

Sources primaires : [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/),
[Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/),
[launchd.plist Apple](https://github.com/apple-oss-distributions/launchd/blob/main/man/launchd.plist.5).
