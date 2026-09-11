---
scope:
  - .agents/skills/methodical-corrector/
  - docs/templates/
  - scripts/verify-active-theme.mjs
  - pocs/macos-connector/
  - docs/architecture/src/theme-customization.dataflow.json
review: on-change
revised: true
---
# ADR-0079 — Menus déclaratifs et gates de correction

- Status: accepted
- Date: 2026-09-12

## Context

La qualification privée Mario Kart a révélé deux défauts de méthode. Une correction
visuelle pouvait modifier des offsets sans prouver l'artefact réellement lancé, et
le connecteur recevait une liste d'étapes tout en construisant deux grilles figées
`character` et `vehicle`. La compilation seule ne détectait ni un ancien RenderHost,
ni une perte de sémantique pendant la conversion, ni une régression visible.

## Decision

Une correction à risque suit un contrat exécutable : reproduction, artefact actif,
source de vérité, chaîne de transformation, hypothèse falsifiable, changement d'une
seule couche et preuves avant/après. Les valeurs expérimentales restent identifiées
et ne peuvent pas être déclarées qualifiées. Le reçu d'artefact lie le descripteur,
l'entrée, l'interface, la miniature, le binaire optionnel et le PID observé par leurs
chemins canoniques et SHA-256.

Le manifeste d'interface v5 rend les catégories de choix ouvertes. Une étape fournit
un identifiant, un libellé, une catégorie, un nombre de colonnes et ses règles de
compatibilité. AppKit construit toutes les sections dans cet ordre ; il ne connaît
aucun nom de jeu et ne branche aucune catégorie particulière. Les overrides v2
transportent une table `selections` indexée par catégorie, séparée de `session_id`.
Le chargement des anciens overrides `character` et `vehicle` les migre vers cette
table sans changer l'identité de la cible.

Les contrôles système restent le catalogue sémantique distinct défini par ADR-0051
et ADR-0078. Cette décision automatise les menus de personnalisation ; elle ne rend
pas dynamique l'autorisation des capacités natives. Une capacité obligatoire sans
composant, état accessible ou asset digesté continue de faire échouer le manifeste.

## Consequences

Un thème hors jeu de course peut déclarer tenue, scène, compagnon ou palette sans
modifier Swift. Ajouter une catégorie est une donnée de package, pas une branche du
runtime. Les anciens packages restent lisibles pendant la migration, mais seule la
v5 prouve un menu entièrement déclaratif.

Le gate devient plus strict et demande davantage de métadonnées aux adaptateurs. En
contrepartie, une correction ne peut plus être acceptée parce qu'un binaire compile
ou parce qu'une seule capture paraît meilleure. Le rollback consiste à restaurer le
dernier package dont le reçu et la qualification visuelle sont tous deux acceptés.
