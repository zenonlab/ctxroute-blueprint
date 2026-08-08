# ADR 0025 — Résolution MangaDex avec promotion MangaUpdates

## Décision

Après `NO_MATCH` MangaUpdates, une correspondance MangaDex unique est une résolution active. FavLib collecte une fois la fiche et la couverture, conserve le payload brut et toutes les variantes localisées, puis planifie la première promotion au lundi suivant à 03:00 `Europe/Paris`.

Une promotion sûre change seulement l’identité publique vers MangaUpdates, conserve les deux identifiants externes et fusionne une identité existante si nécessaire. Les métadonnées, descriptions et couverture MangaDex ne sont ni remplacées ni rafraîchies automatiquement. Les échecs et ambiguïtés sont reportés d’une semaine.

Le matcher partagé reste ordonné-exact, mots significatifs réordonnés, puis distance bornée avec gagnant unique. Rang, popularité et audience sont exclus. MangaDex reste absent des saisies manuelles et de l’extension.
