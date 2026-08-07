# ADR 0022 — Résolution bornée et traçable AniList

- Statut : accepté
- Date : 2026-08-04
- Remplace les règles de score et d’ambiguïté fournisseur des ADR 0017 et 0021

## Décision

Les recherches AniList utilisent les alias `source`/`personal` issus du favori et de son URL. Les titres observés chez AniList restent des champs de candidats et ne deviennent jamais des alias source. Les variantes de ponctuation, tirets, espaces et tokens sont bornées, paginées et conservées avec leur provenance. Seuls les alias `source` produits par le parser portent la décision : une identité normalisée/compacte unique peut être résolue ; deux identités exactes ou aucun exact restent dans la review. Les titres personnels servent seulement à la découverte et au classement. Le type AniList reste contraint à `ANIME` ou `MANGA`. Aucune œuvre ou correction lexicale particulière n'est codée dans le résolveur.

MangaUpdates demeure l’identité canonique des œuvres de lecture et fournit leur couverture dans sa propre lane. AniList ne recherche ni ne remplace les images MangaUpdates.

Tous les appels GraphQL AniList des workers et outils partagent une gate à 2,1 secondes. Les recherches et lectures par ID passent par cette gate ; les IDs sont regroupés par lots de 50. Sur HTTP 429, le slot courant est libéré, la pipeline attend réellement `Retry-After` ou `X-RateLimit-Reset`, puis reprend un slot et réessaie. Un `X-RateLimit-Remaining: 0` bloque les nouvelles acquisitions jusqu’au reset annoncé.

Les codes de résolution (`KNOWN_EXTERNAL_ID`, `NORMALIZED_EXACT`, `COMPACT_EXACT`, `TYPE_MISMATCH`, `LOW_CONFIDENCE`, `NO_RESULT` ou code d’erreur API) sont conservés dans l’état d’enrichissement et la review. Une review ne sélectionne jamais le premier résultat automatiquement.

## Conséquences

Cette règle privilégie une décision utilisateur auditable lorsque le fournisseur répond sans fournir une correspondance déterministe. Les snapshots contiennent les candidats récupérés pour permettre la réparation sans nouvelle hypothèse. Les téléchargements CDN image restent individuels.
