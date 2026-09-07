---
scope:
  - docs/systems/favorite-parsing-resolution-spec.md
  - docs/architecture/src/favorite-resolution.dataflow.json
  - packages/domain/**
  - packages/application/**
  - packages/contracts/**
  - packages/adapters-browser/**
  - packages/adapters-indexeddb/**
  - apps/extension/**
review: on-change
---

# ADR-0037 — Versionner le contrat d’analyse et de résolution des favoris

- Status: accepted
- Date: 2026-09-07

## Contexte

L’audit du moteur FavLib a retrouvé des règles utiles de parsing de titre,
d’identité URL, de saison, de progression et de matching fournisseur. Elles
étaient toutefois réparties entre un parser dense, un module metadata
monolithique, une file locale et un background MV3. Certaines règles se
chevauchaient et l’architecture laissait les favoris navigateur concurrencer la
base locale.

Le TobiRink actuel importe bien les favoris HTTP(S) en `FavoriteSource` et
`Review`, mais ne possède pas encore un chemin de résolution neuf complet et
composé. Réécrire sans contrat ferait perdre des cas qui protègent notamment
les saisons, les nombres intrinsèques aux titres, les slugs techniques et les
ambiguïtés fournisseur.

## Décision

Adopter
[`favorite-parsing-resolution-spec.md`](../systems/favorite-parsing-resolution-spec.md)
comme contrat canonique préalable à la réécriture.

Conserver les entrées brutes et toutes les transformations dans un artefact
versionné. Séparer les preuves d’identité, de saison et de progression. Toute
politique de matching est pure, symétrique entre fournisseurs et exige une
unique identité distincte à chaque niveau. Identifiant et URL exacts précèdent
le titre exact, la saison explicitement corroborée, les mots significatifs
réordonnés et la distance d’édition bornée. Popularité, rang, ordre, date,
image, inclusion partielle et richesse de fiche ne sont jamais des preuves.

Conserver la reprise MV3 dans une file IndexedDB durable dont l’entrée est
écrite avant le réseau. Résolution, hydratation exacte et contribution Review
sont des opérations séparées. Les effets sont idempotents et les attentes
longues sont persistées plutôt que gardées en mémoire.

Maintenir ADR-0025 : IndexedDB est la seule autorité privée. Les favoris sont
des commandes d’import et leur suppression ne supprime pas une œuvre ou une
progression. Maintenir ADR-0033 : toute contribution collective exige un
consentement distinct, révocable et revérifié.

Rejeter le portage direct des modules FavLib. La réécriture utilise des contrats
et modules TobiRink séparés, un corpus synthétique local et une matrice de
traçabilité. Les anciennes versions servent seulement de référence
comportementale.

## Conséquences

Chaque changement de règle exige une version, une fixture synthétique, une
comparaison d’artefact complet et une migration ou invalidation explicite. Les
ambiguïtés deviennent visibles dans Review au lieu d’être masquées par un
classement fournisseur.

Le premier chantier de code devra composer le pipeline complet depuis les
événements favoris jusqu’aux écritures `FavoriteSource`, `Review` et `Work`.
Il devra aussi remplacer le scan et le traitement monolithiques par des tranches
durables bornées. Cette ADR n’active aucun réseau, permission MV3, fournisseur,
déploiement ou migration de données.
