---
scope:
  - packages/application/src/recovery/**
  - packages/application/src/favorites/**
  - packages/application/src/ports/cloud-data-ports.ts
  - packages/application/src/ports/capability-ports.ts
  - packages/application/src/use-cases/import-favorite-sources.ts
  - packages/adapters-browser/src/bookmarks/**
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-browser/src/recovery/**
  - packages/adapters-cloudflare/src/catalogue/**
  - apps/extension/runtime/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/worker/migrations/**
  - apps/worker/src/catalogue/**
  - apps/worker/src/composition.ts
  - apps/worker/wrangler.jsonc
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0043 — Reconstruction cache-first après réinstallation

- Status: accepted
- Date: 2026-09-12
- Revised: 2026-09-12
- Supersedes: les restrictions de l’ADR-0038 qui interdisaient toute métadonnée publique dans D1 et le snapshot sans associations de l’ADR-0037

## Contexte

La production possède les tables du catalogue et du collectif, mais elles sont
vides. La restauration `storage.sync` hydrate au plus deux identifiants par
passage et son état incomplet ne programme pas toujours un nouveau réveil. Le
scan de publication s’arrête lui aussi après cent œuvres lorsque aucun autre
travail ne maintient le background actif. Une réinstallation peut donc refaire
des recherches fournisseur et n’afficher qu’une partie d’un grand inventaire.

Une liste d’identifiants sans relation avec la clé parsée ne suffit pas à
reconstruire efficacement `FavoriteSource → Work`. Le catalogue D1 ne réduit
aucune requête tant qu’aucun chemin validé ne l’alimente.

## Décision

La reconstruction applique cet ordre : inventaire navigateur et projection
locale, associations `storage.sync`, cache public D1, puis recherche fournisseur.
Une phase incomplète possède une échéance durable et ne dépend jamais d’un
événement sans rapport pour reprendre.

Le snapshot synchronisé v2 conserve les listes d’identifiants v1 et ajoute des
associations bornées entre l’empreinte normalisée versionnée, le type média et
au plus cinq références fournisseur publiques. Les générations v1 restent
lisibles. Les fragments sont triés, dédupliqués, vérifiés par digest et restent
sous les quotas navigateur. Aucun titre, URL de favori, dossier, progression,
décision ou secret n’entre dans `storage.sync`.

Le scan conserve un checkpoint après chaque page de cent œuvres ou sources et
traite au plus seize pages par réveil MV3. Cette tranche publie une bibliothèque
de 1 406 sources dans le réveil qui suit la convergence, sans transformer la
pagination en scan illimité; un catalogue plus grand reprend au checkpoint
suivant. Chromium accède à `storage.local` et `storage.sync` par l’API native
requise par `setAccessLevel`; Firefox conserve son API WebExtension native.

La lecture restaure la génération valide la plus récente et sa génération de
rollback validée. Plusieurs manifests concurrents de la même génération sont
fusionnés sans choisir arbitrairement une identité. Après publication et
validation du digest, l’adaptateur retire les fragments plus anciens ou
orphelins avec une écriture espacée; une génération en cours n’est jamais
collectée.

Le Worker expose le cache public borné défini par l’ADR-0046. Une lecture par
empreinte ou référence précède les API fournisseurs. Un client peut seulement
créer un claim `PENDING` et proposer des identifiants fournisseur publics; il ne
publie jamais une association, un titre, une facette ou un profil. Un collecteur
GitHub OIDC hydrate et vérifie ces identifiants avant la seule transition
`VERIFIED`. L’unicité D1 empêche deux recherches concurrentes; un bail expiré
autorise une reprise bornée.

Les URLs privées, sources de favoris, titres bruts, dossiers, progressions,
décisions privées, owners, identifiants d’installation et secrets restent
exclus. L’extension hydrate ensuite par identifiant lorsque les détails
locaux manquent. Les
jaquettes conservent la politique de droits de l’ADR-0026 et restent dans R2.
Le curseur de réparation des jaquettes est persisté dans IndexedDB afin qu’un
arrêt MV3 reprenne le prochain lot. L’ingestion R2 reste une opération bornée
derrière la gate de droits : aucune URL fournisseur ne devient implicitement
une autorisation de copie.

Les événements de création, modification, déplacement et suppression d’un
favori sont journalisés avant traitement. Un favori isolé est relu et réimporté
directement; une suppression détache directement sa source connue. Les
mutations de dossier, impossibles à réduire à une source unique, déclenchent
l’inventaire complet reprenable. Un audit complet périodique de six heures
réconcilie aussi les événements perdus pendant l’arrêt du navigateur.

La route déclarative des règles reste publique. Le cache ne possède ni
inscription, ni propriétaire, ni appairage, ni réglage Collectif.

La publication vers le cache ne bloque jamais le commit IndexedDB. Une panne D1
laisse un job local réessayable et n’autorise aucun fallback de décision. Une
réponse D1 est hydratée ou comparée avec les mêmes règles d’identité que toute
référence exacte.

## Conséquences

Une première résolution peut encore appeler un fournisseur. Les réinstallations
et utilisateurs suivants réutilisent ensuite les associations synchronisées ou
le cache D1. Un snapshot corrompu, un cache indisponible ou une écriture
interrompue reste reprenable sans perte locale. La migration D1 est additive et
ne supprime aucune table ni donnée existante.

Le parcours Chromium installé supprime entièrement IndexedDB après publication
du manifeste v2, arrête le service worker et coupe le cache public. Le
redémarrage reconstruit 1 406 sources et réhydrate l’ID AniList exact sans
recherche textuelle. Les tests communs des adaptateurs couvrent les mêmes
fragments, digests, rollbacks et restrictions d’accès Chrome/Firefox.
