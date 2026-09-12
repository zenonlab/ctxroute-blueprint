---
scope:
  - docs/templates/game-theme-authoring-evidence.schema.json
  - docs/templates/game-theme-authoring-run.schema.json
  - scripts/verify-game-theme-authoring-run.mjs
  - pocs/macos-connector/Sources/ThemeModel/ThemeInterface.swift
  - pocs/macos-connector/Tests/ConnectorTests/ThemeInterfaceTests.swift
  - tools/game-library/src/mkw.rs
  - docs/pocs/mkw-course-adapter-results.md
  - tests/theme-authoring.test.mjs
  - docs/architecture/src/theme-customization.dataflow.json
review: on-change
---
# ADR-0083 — Preuves typées et parité des consommateurs de thème

- Status: accepted
- Date: 2026-09-12

## Contexte

Un hash prouve l'identité d'un fichier, pas la nature de son contenu. Un même JSON
générique pouvait donc servir de preuve à plusieurs gates sans démontrer leurs
assertions. Par ailleurs, le schéma d'interface v5 exposait des placements, sockets,
empreintes et paramètres de pin que le modèle Swift ne décodait pas intégralement.

## Décision

Chaque référence de gate nomme un enregistrement dans un reçu
`orbite.game-theme-authoring-evidence/1`. L'enregistrement déclare exactement son gate,
un verdict et les checks obligatoires propres à ce gate. Un gate `pass` exige un reçu
`pass`, tous ses checks en succès et toutes ses pièces jointes présentes avec leur
SHA-256. Un reçu générique ou associé à un autre gate est refusé.

Les consommateurs Swift et Rust représentent tous les champs du contrat v5 qu'ils
transportent. Un champ destiné uniquement au connecteur ou uniquement au renderer est
quand même décodé et validé par l'autre côté ; il n'est jamais supprimé silencieusement.
Les clés racines inconnues sont refusées avant le décodage Swift.

Les adaptateurs de formats sources publient leur provenance résolue sous forme d'une
table `source_artifacts` bornée. Le RenderHost ne reçoit aucun nom de champ imposé par
un moteur ou un format de jeu particulier.

## Conséquences

Le ledger ne remplace pas les oracles visuels, mais il ne peut plus qualifier seize
étapes avec une présence de fichier non typée. Toute évolution de l'interface exige
un test de parité JSON entre schéma, Swift et Rust.
