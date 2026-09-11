---
scope:
  - pocs/theme-behavior-kernel/
  - docs/architecture/src/runtime-infrastructure.architecture.json
review: on-change
revised: true
---
# ADR-0069 — Protocole de sessions typé et simulateur déterministe

- Status: accepted
- Date: 2026-09-10

## Decision

M5 expose uniquement présence, activité et déconnexion, ainsi que les intentions
`focus` et `open`. Chaque événement porte un identifiant et une séquence monotone ;
les doublons ne rejouent rien. Le simulateur ne contient ni PTY, ni texte de session,
ni commande shell. L'identité de session reste indépendante de l'apparence.

## Consequences

Présence, activité, erreur, récupération et reconnexion sont testables sans terminal.
Le provider terminal réel pourra implémenter ce contrat ultérieurement. Les tests purs
macOS de Finder, surfaces et visibilité ne valent toujours pas qualification physique
de Spaces, veille ou multi-écran.

## Implementation evidence

`TerminalSessionSimulator` refuse les événements dupliqués ou non monotones et les
intentions corrélées rejouées. Les états couvrent `idle`, `active`, `busy`, `success`,
`error`, `recovering` et `disconnected`; aucun champ ne porte le contenu d'un terminal.
