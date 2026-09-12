---
scope:
  - packages/application/src/recovery/**
  - packages/application/src/favorites/**
  - packages/application/src/collective-index/favorite-collective-protocol.ts
  - packages/application/src/ports/cloud-data-ports.ts
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-browser/src/recovery/**
  - packages/adapters-cloudflare/src/catalogue/**
  - packages/adapters-cloudflare/src/reviews/d1-favorite-collective-adapter.ts
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

Le Worker expose un cache public borné. Une lecture par empreinte ou référence
précède les API fournisseurs. Une contribution contient seulement empreinte,
versions, type, références et fiche publique déjà validée par les schémas
fournisseur. Le Worker l’enregistre comme job idempotent, puis effectue des
upserts préparés dans les tables de catalogue et de clés. Les conflits de même
empreinte restent non résolus jusqu’à une preuve unique; aucun premier résultat
ne gagne. Les requêtes et écritures sont limitées par lot, taille et quota.

D1 peut conserver les titres et aliases publics d’une fiche fournisseur ainsi
que les genres, année, format, statut, totaux et popularité nécessaires au
tri. Ces données décrivent l’œuvre publique, jamais l’appartenance d’un
utilisateur. Les URL de favoris, dossiers, progression personnelle, décisions,
diagnostics et secrets restent exclusivement locaux. Les jaquettes conservent
la politique de droits de l’ADR-0026 : une URL publique peut être référencée,
mais R2 n’est alimenté que par la gate média autorisée.

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
