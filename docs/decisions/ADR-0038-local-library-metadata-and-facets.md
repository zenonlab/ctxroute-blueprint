---
scope:
  - docs/architecture/src/tobirink.architecture.json
  - packages/domain/**
  - packages/application/**
  - packages/adapters-browser/**
  - packages/adapters-indexeddb/**
  - packages/ui/**
  - apps/extension/**
review: on-change
---

# ADR-0038 — Métadonnées locales, facettes et statistiques de bibliothèque

- Status: accepted
- Date: 2026-09-09

## Contexte

Les fiches hydratées conservent déjà certains genres, mais la projection de
bibliothèque les retire et filtre seulement la page chargée. Les facettes
sélectionnées peuvent ainsi disparaître. Les règles de statut de
l'organisateur existent sans recevoir de statut éditorial réel.

## Décision

Conserver dans la fiche `Work` privée uniquement les faits structurés utiles à
la bibliothèque : genres, format, statut éditorial canonique, années, totaux
d'épisodes/chapitres/volumes et popularité accompagnée de sa nature. Le
fournisseur de la fiche constitue la provenance. Une valeur absente reste
inconnue; aucune donnée ne doit être inventée ou utilisée pour le matching.

Effectuer recherche, filtrage, tri, facettes et statistiques dans
l'application avant pagination. Les options de facettes proviennent du corpus
borné complet et restent présentes pendant une sélection multiple. Distinguer
le statut éditorial (`UPCOMING`, `ONGOING`, `HIATUS`, `COMPLETED`,
`CANCELLED`, `UNKNOWN`) de la progression personnelle.

Comparer la popularité uniquement à nature identique (`MEMBERS` ou `RANK`) et
à fournisseur identique. Les valeurs manquantes ou incomparables passent après
les valeurs comparables avec un départage stable par titre puis ID.

Ces faits, les filtres et les statistiques restent dans IndexedDB. D1 et
`storage.sync` ne reçoivent aucun champ supplémentaire. Les descriptions,
synopsis, personnes, critiques et textes éditoriaux ne sont pas collectés.

## Conséquences

IndexedDB v13 ajoute seulement des index de lecture aux fiches existantes. Les
champs sont optionnels et les anciennes fiches restent valides; leur prochaine
hydratation les complète sous les limites et quotas fournisseurs existants.
L'export privé reste rétrocompatible et valide les nouveaux champs au travers
du contrat candidat. Les statistiques signalent une projection tronquée plutôt
que de prétendre couvrir une bibliothèque au-delà de la borne locale.
