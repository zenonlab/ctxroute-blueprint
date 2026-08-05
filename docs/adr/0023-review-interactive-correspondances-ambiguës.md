# ADR 0023 — Review interactive des correspondances ambiguës par favori

## Statut

Accepté — 2026-08-05.

## Décision

Lorsqu’AniList ou MangaUpdates renvoie plusieurs œuvres plausibles, FavLib crée une review attachée au favori individuel `(user_id, installation_id, bookmark_id)` et au fournisseur. La review conserve le titre et l’URL originales, son état `PENDING`, `RESOLVED` ou `NO_MATCH`, le candidat choisi et la décision.

Chaque candidat conserve l’identifiant fournisseur, le titre canonique, `hit_title`, les titres associés, type, année, date de début, statut, auteurs, catégories, genres, image, URL et payload complet d’audit. Les candidats ne deviennent pas des œuvres favorites avant sélection.

Le worker détaille les candidats ambigus avant affichage et ne choisit pas automatiquement entre un titre exact et une variante parenthésée. Le titre personnel, les chapitres, releases et suffixes `VF`/`VOSTFR` servent au matching mais ne remplacent jamais le titre canonique fournisseur.

Une seule notification active `FAVORITE_REVIEW_REQUIRED` existe par review. Les anciens `FAVORITE_UNRESOLVED` ne sont plus émis ; un échec sans candidat ouvre une review vide permettant une recherche manuelle. Une résolution passe uniquement le favori ciblé à `matched`, supprime sa notification active et conserve reviews, candidats et payloads.

Une résolution fournisseur ultérieure peut fermer une review créée automatiquement seulement si `decision IS NULL`, si l'identité active appartient au même fournisseur et si le titre ne fait pas partie de la liste manuelle protégée. Elle écrit une décision technique `automatic-provider-resolution`; elle ne remplace jamais une décision utilisateur.

## API et interface

- `GET /api/v1/reviews` liste les reviews personnelles ;
- `GET /api/v1/reviews/:id` renvoie favori, candidats, liens fournisseurs et recherches Google préremplies ;
- `POST /api/v1/reviews/:id/resolve` sélectionne un candidat de cette review ;
- `POST /api/v1/reviews/:id/manual` valide un identifiant ou une URL AniList/MangaUpdates ;
- `POST /api/v1/reviews/:id/no-match` ferme la review sans créer de média incorrect.

Toutes les routes filtrent par `user_id`. L’écran `/review/:id` sépare titre personnel, URL originale, titres canoniques, variantes, métadonnées et liens fournisseur.

## Données et cycle de vie

`favorite_review` appartient à l’utilisateur et est supprimée avec son compte. `favorite_review_candidate` est une provenance d’audit liée à la review ; ses payloads suivent la politique fournisseur et ne sont jamais un cache public. Les favoris, profils, progressions, releases et historiques ne sont pas supprimés lors d’une décision.

Les sauvegardes et restaurations conservent reviews résolues, candidats et décisions. Une purge fournisseur peut supprimer les payloads selon sa politique sans supprimer le favori personnel ni son historique de décision.

## Tests attendus

Fixture `Existence` / `Existence (Wang)`, retries idempotents, résolution du seul favori ciblé, conservation des candidats après résolution, URL fournisseur invalide, mauvais type, `NO_MATCH`, isolation Alice/Bob et parcours notification → `/review/:id`.
