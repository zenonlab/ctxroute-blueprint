---
scope:
  - packages/domain/src/favorites/contracts.ts
  - packages/application/src/ports/quick-preferences-port.ts
  - packages/application/src/library/read-library-catalogue.ts
  - packages/application/src/library/read-library-page.ts
  - packages/application/src/use-cases/search-local-library.ts
  - packages/application/src/use-cases/read-local-review-candidates.ts
  - packages/application/src/use-cases/read-review-queue.ts
  - packages/application/src/popup/popup-context.ts
  - packages/public-discovery/src/providers/*.ts
  - apps/extension/runtime/*.ts
  - apps/extension/wxt-entrypoints/background.ts
  - docs/02-quality-strategy.md
  - docs/architecture/src/adaptive-public-refresh.dataflow.json
review: on-change
---

# ADR-0056 — Classification adulte et visibilité locale

- Status: accepted
- Date: 2026-09-16

## Context

Les fournisseurs peuvent exposer des œuvres adultes, mais la préférence de
l’utilisateur est une décision locale de présentation. La collecte publique et
la conservation locale doivent donc rester indépendantes de cette préférence.
Les signaux ne sont pas uniformes et leur absence ne doit pas être interprétée
comme une preuve de contenu non adulte.

## Decision

Chaque adaptateur fournit une classification `adult`, `non-adult` ou `unknown`
avec le signal du fournisseur comme provenance : AniList `isAdult`, MangaDex
`contentRating`, Kitsu `nsfw`/`ageRating`, et les catégories ou genres adultes
explicites de MangaUpdates. Les signaux absents ou ambigus deviennent
`unknown`; `ecchi` seul ne devient pas adulte.

La préférence locale `showAdultContent` est persistée dans les préférences
rapides et vaut `false` par défaut. Lorsqu’elle est désactivée, seules les
œuvres explicitement `adult` sont exclues des surfaces et actions locales.
`unknown` reste visible : une absence de signal n'est jamais enregistrée comme
preuve `non-adult`. Les données exclues restent stockées et redeviennent
visibles après activation.

## Alternatives

Supprimer les données à la désactivation perdrait l’état privé et provoquerait
une recollecte inutile. Masquer `unknown` bloquerait des œuvres sans preuve
adulte; le marquer `non-adult` fabriquerait une preuve inexistante. Un simple
masquage CSS laisserait passer les URLs, actions et notifications.

## Consequences

Les lecteurs locaux filtrent avant pagination, facettes, statistiques,
notifications et projection WebBridge. Les tests couvrent les cinq adaptateurs,
la compatibilité des préférences existantes et le comportement conservateur
`OFF`/`ON`.

## Sources

- [AniList Media object](https://docs.anilist.co/reference/object/media)
- [AniList query arguments](https://docs.anilist.co/reference/query)
- [AniList API considerations](https://docs.anilist.co/guide/considerations)
