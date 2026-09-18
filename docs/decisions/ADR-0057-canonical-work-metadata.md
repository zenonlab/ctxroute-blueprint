---
scope:
  - apps/worker/migrations/**
  - apps/worker/src/catalogue/**
  - packages/application/src/ports/cloud-data-ports.ts
  - packages/adapters-cloudflare/src/catalogue/**
  - packages/public-discovery/src/**
  - docs/architecture/src/adaptive-public-refresh.architecture.json
review: on-change
revised: true
---

# ADR-0057 — Métadonnées courantes par œuvre canonique

- Status: accepted
- Date: 2026-09-17
- Revised: 2026-09-19

## Contexte

Chaque clé Discovery VERIFIED conserve actuellement une copie complète du
profil. Un alias peut donc servir une ancienne valeur et un changement de
compteur ne modifie pas forcément la révision catalogue. Les réponses
partielles peuvent aussi perdre une valeur déjà vérifiée.

## Décision

Ajouter `catalogue_current_metadata`, une ligne par `work_id`. Les colonnes
typées portent statut, totaux annoncés, dernières sorties confirmées,
classification, couverture et provenance minimale. Les petites collections et
le profil public reconstruit restent dans des JSON bornés et validés.

Une publication VERIFIED charge la fiche courante, refuse un changement de
type média pour le même `work_id`, puis complète uniquement les champs absents
du nouveau profil avec les valeurs connues. Les références sont réunies par
identité exacte. Un contenu sémantiquement identique ne change ni fiche ni
révision; compteur, classification ou autre métadonnée publique modifiée crée
une révision visible par tous les alias.

Les réponses Discovery et Catalogue lisent cette source commune. Les copies
historiques dans les résultats Discovery restent temporairement disponibles
pour rollback, mais ne sont plus l'autorité. Leur arrêt puis leur suppression
relèvent de la bascule et du nettoyage séparément vérifiés.

Un total annoncé reste distinct d'une dernière sortie confirmée. Les numéros
confirmés sont textuels afin de conserver fractions et suffixes. Les champs
absents ne font jamais progresser un compteur et une prévision Agenda ne peut
alimenter ces colonnes.

## Conséquences

Les alias convergent vers une seule fiche, les mises à jour partielles sont
non destructives et les filtres disposent de colonnes stables. Le backfill
signale les contradictions de type dans une table dédiée au lieu de fusionner
silencieusement les identités. La migration est additive; aucun ancien objet
n'est supprimé.

La publication d'un statut met aussi à jour le modèle Agenda existant dans
le même batch D1, même sans nouvelle sortie. L'intervalle historique reste
conservé pendant un hiatus; la projection suspend les estimations. Les
compteurs annoncés du profil v3 ne sont jamais remplacés par une séquence
confirmée, qui conserve sa colonne textuelle distincte.
