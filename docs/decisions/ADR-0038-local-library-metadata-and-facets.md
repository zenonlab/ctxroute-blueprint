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
revised: true
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
à fournisseur identique. Le tri choisit la cohorte comparable la plus
représentée dans le résultat filtré, avec la clé fournisseur/nature comme
départage déterministe. Les valeurs manquantes ou hors cohorte passent après
les valeurs comparables avec un départage stable par titre puis ID.

La requête lit au plus 500 identifiants dans une transaction IndexedDB, applique
les inclusions multiples par union au sein d'une facette, les facettes entre
elles par intersection, puis pagine par 24. Les sept listes d'options sont
calculées sur le corpus borné avant filtrage et limitées à 64 valeurs. Un clic
ne démonte pas la barre de filtres : le menu reste ouvert pour permettre
plusieurs inclusions ou exclusions successives.

Ces faits, les filtres et les statistiques restent dans IndexedDB. D1 et
`storage.sync` ne reçoivent aucun champ supplémentaire. Les descriptions,
synopsis, personnes, critiques et textes éditoriaux ne sont pas collectés. Les
messages MV3 stricts exposent uniquement la projection nécessaire aux cartes,
facettes et compteurs.

## Conséquences

IndexedDB v13 ajoute seulement des index de lecture aux fiches existantes. Les
champs sont optionnels et les anciennes fiches restent valides; leur prochaine
hydratation les complète sous les limites et quotas fournisseurs existants.
L'export privé reste rétrocompatible et valide les nouveaux champs au travers
du contrat candidat. Les statistiques signalent une projection tronquée plutôt
que de prétendre couvrir une bibliothèque au-delà de la borne locale.
