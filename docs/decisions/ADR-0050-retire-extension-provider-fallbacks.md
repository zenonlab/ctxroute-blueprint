---
scope:
  - apps/extension/public/rules/mangaupdates-transport.json
  - apps/extension/scripts/installed-mangaupdates.mjs
  - apps/extension/runtime/favorite-provider-runtime.ts
  - apps/extension/runtime/provider-identity-recovery-runtime.ts
  - apps/extension/runtime/provider-identity-recovery-runtime.test.ts
  - apps/extension/runtime/favorite-resolution-runtime.ts
  - apps/extension/runtime/favorite-resolution-runtime.test.ts
  - apps/extension/runtime/favorite-resolution-d1-boundary.test.ts
  - apps/extension/security/extension-security.test.ts
  - packages/application/src/agenda/**
  - packages/adapters-browser/src/index.ts
  - packages/adapters-browser/src/releases/**
  - packages/adapters-indexeddb/src/index.ts
  - packages/adapters-indexeddb/src/database.ts
  - packages/adapters-indexeddb/src/releases/**
  - packages/adapters-indexeddb/test/migrations-entry.ts
  - docs/02-quality-strategy.md
  - docs/browser-support.md
  - docs/architecture/src/favorite-source-boundaries.architecture.json
  - docs/architecture/src/extension-delivery-validation.dataflow.json
review: on-change
revised: true
---

# ADR-0050 — Retrait des fallbacks fournisseur de l’extension

- Status: accepted
- Date: 2026-09-15
- Revised: 2026-09-19

## Contexte

La composition MV3 utilise exclusivement Public Discovery v3 pour la
résolution et la génération D1 partagée pour Agenda. Le dépôt conservait
pourtant une règle DNR MangaUpdates, un script de vérification installé, deux
runtimes fournisseur non composés et une chaîne Agenda de collecte directe
encore exportée et testée.

## Décision

Supprimer ces implémentations et leurs tests. `FavoriteResolutionRuntime` ne
porte plus de branche optionnelle de restauration, publication ou hydratation
directe : il prépare les caches publics, exécute la file D1 et programme sa
continuation bornée.

Les interfaces de records nécessaires au cache Agenda partagé quittent le
fichier du fallback pour un module de stockage neutre. Le schéma IndexedDB
historique reste additif afin que les profils existants continuent de s’ouvrir.
Lorsqu’une génération partagée est enregistrée, elle efface encore les lignes
de staging et l’ancien checkpoint local; aucune API publique ne permet de
réactiver la collecte directe.

Les adaptateurs fournisseurs portables du consumer Queue natif restent hors de
l’extension. Les extracteurs locaux d’identifiants présents dans les URL de
favoris restent purs et sans réseau.

## Conséquences

Le cache partagé conserve les modèles v4 et leur fenêtre de couverture, en
plus de la projection. Naviguer dans cette couverture recalcule les dates
localement. Chaque lecture HTTP est bornée à dix secondes et un mégaoctet;
le réveil dispose de vingt secondes, cent pages et dix mégaoctets. Une
génération modifiée entre pages autorise un seul redémarrage. Les ETag restent
propres aux pages; seul celui de la première page sert à sa revalidation.

Toute erreur réseau, réponse invalide ou dépassement conserve le cache valide
de moins de huit jours et expose son état ancien. Une confirmation HTTP ou un
cache de moins d'un jour expose l'état courant. Aucun fournisseur ne sert de
repli. Les modèles et la couverture sont des champs optionnels du record
IndexedDB existant; les anciennes installations restent lisibles.

La projection porte sa fenêtre dans sa révision locale. Une transaction
conserve l'historique, remplace la liste d'événements actifs et met à jour
les entrées servant aux notifications. Un événement remplacé ou annulé devient
indisponible dans cette dernière table; une tâche ancienne vérifie encore
la date courante avant émission. Les preuves manuelles restent actives.

La réutilisation d’une fiche locale déjà vérifiée reste permise avant D1,
même lorsque ses métadonnées sont anciennes. Elle ne déclenche aucune
hydratation fournisseur MV3. Une référence sync seule exige une vérification
publique; elle ne constitue pas une fiche vérifiée. Le rafraîchissement des
métadonnées est indépendant de la validité de l’identité locale.

Les archives Chrome et Firefox ne contiennent plus la règle DNR orpheline et
leur nombre de fichiers diminue d’une unité. La première candidate qui
matérialise cette frontière exhaustive est `1.0.31`; elle est maintenant
publiée après une publication R2 explicitement approuvée. Une panne D1 rend la découverte ou
l’Agenda indisponible selon leurs contrats de cache; elle ne déclenche jamais
un appel fournisseur depuis MV3. Les suppressions restent récupérables par
revert du commit et n’effacent aucune base IndexedDB installée à distance.
