---
scope:
  - pocs/macos-connector/**
  - docs/architecture/src/macos-theme-discovery.dataflow.json
  - docs/pocs/macos-connector-poc2.md
review: on-change
---
# ADR-0072 — Découverte automatique des packages locaux

- Status: accepted
- Date: 2026-09-10

## Decision

Le connecteur ne maintient aucune liste de thèmes par nom. Il parcourt au plus seize
bibliothèques locales configurées, recherche des fichiers `orbite-theme.json`, puis
sélectionne un adaptateur à partir des champs `format` du descripteur et de son entrée.
Le descripteur `orbite.theme-package/1` fournit une identité, un nom affiché, un
renderer, une entrée relative et un aperçu PNG relatif facultatif.

Le parcours ignore les paquets d'app et les éléments cachés, borne le nombre de
descripteurs et la taille des fichiers, refuse les liens symboliques, sorties de
répertoire, formats incohérents et identités dupliquées. Son ordre et son reçu JSON
sont déterministes. Les racines proviennent des préférences de l'utilisateur, de la
convention locale `Application Support/Orbite/Themes`, ou de `ORBITE_THEME_PATHS`
pour le diagnostic ; aucun chemin de dépôt et aucun nom de jeu n'apparaît dans Swift.

Le catalogue de fixtures natives cesse également de lire `catalog.json` : il découvre
tous les manifestes compatibles présents dans son bundle. L'ancien fichier reste
inerte parce que sa suppression exige une confirmation distincte.

## Consequences

Le package Mario Kart local peut déclarer sa recette `orbite.scene-probe/1` dans son
dossier privé sans copier ses assets ni les publier dans Git. Le scanner prouve sa
découverte et expose le package dans l'app. Cette décision ne prétend pas que le
`RenderHost` Bevy produit déjà des images dans le `CAContext` du provider : ce raccord
reste un gate séparé et doit échouer explicitement plutôt que montrer une fausse
projection Core Animation.
