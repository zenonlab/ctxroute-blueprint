# ADR 0020 — Releases MangaUpdates et calendrier séparé

> Étendu et partiellement remplacé par [ADR 0021](0021-responsabilites-fournisseurs.md). La « progression fournisseur » désigne l’état public de publication, jamais la progression personnelle.

## Décision

MangaUpdates est la source opérationnelle des releases et de l’état de publication manga, manhwa et manhua via `https://api.mangaupdates.com/v1`. FavLib résout d’abord chaque œuvre rencontrée avec `POST /series/search`, puis récupère sa fiche avec `GET /series/{series_id}`. Le flux global authentifié complète ensuite les releases. Aucun scraping ni téléchargement d’image MangaUpdates n’est autorisé.

AniList reste la source des métadonnées générales, du calendrier anime et des images. Une entrée `SCHEDULED` issue d’AniList, une entrée `ANNOUNCED` issue de MangaUpdates et une disponibilité `AVAILABLE` issue d’une origine utilisateur sont trois états distincts.

## Résolution et erreurs

Un identifiant MangaUpdates déjà associé évite toute recherche supplémentaire. Les titres exacts, multilingues et synonymes sont ensuite comparés ; une égalité reste en `review`. Les réponses invalides, timeouts et `429` alimentent la gate, le circuit/backoff, la lease et le diagnostic durable sans créer de doublon. Les groupes ou langues ne changent pas la clé logique d’un même chapitre.

## Réinitialisation

Le reset catalogue exige la confirmation exacte `RESET-FAVLIB-CATALOG` et conserve les politiques autorisées `anilist` et `mangaupdates`.
