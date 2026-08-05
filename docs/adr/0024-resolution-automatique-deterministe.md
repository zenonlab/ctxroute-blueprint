# ADR 0024 — Résolution automatique déterministe et reprise terminale

## Statut

Accepté — 2026-08-06.

## Contexte

Le passage à une priorité « titre exact » a supprimé le fallback scoré MangaUpdates, assimilé `OEL` à un type non graphique, puis laissé des reviews en attente après des erreurs PostgreSQL de typage de paramètres. Les sweeps recréaient ensuite des jobs que l'état `TERMINAL` empêchait de réclamer. Une identité persistée ne réconciliait pas toujours la review historique.

## Décision

La sélection suit l'ordre suivant : identifiant fournisseur connu, exact unique compatible, puis meilleur score déterministe au-dessus du seuil. L'ordre de réponse n'est jamais un signal. Les romans et fiches mortes sont rejetés avant scoring.

`OEL` est compatible uniquement avec une preuve graphique explicite dans la fiche (`Chapter`, `Webtoon`, `Webcomic` ou `Comic`) et en l'absence de tout marqueur de roman. Le type canonique FavLib reste celui reconnu par la source favorite tant que MangaUpdates ne fournit pas `Manga`, `Manhwa` ou `Manhua`.

Une inflexion `return/returns/returned/returning` peut être normalisée dans le score multi-token. Une saison arabe/romaine peut être normalisée uniquement en suffixe final lorsque la base du titre est identique. Ces variantes ne permettent pas de départager deux candidats égaux.

Les requêtes JSON/textes du chemin review utilisent des casts PostgreSQL explicites. Toute modification de sémantique incrémente la version d'enrichissement. Le sweep ignore un état `TERMINAL` à version courante, sauf invalidation explicite. La reprise des reviews est dédupliquée par fournisseur/média, limitée à trois tentatives et exclut décisions existantes et reviews manuelles.

La réconciliation automatique exige une `media_metadata ACTIVE` du même fournisseur, une review `PENDING`, `decision IS NULL` et un titre non protégé. Les snapshots et candidats d'audit sont conservés.

## Retour arrière

Désactiver la resynchronisation et restaurer les versions précédentes du worker. Ne jamais supprimer les états, snapshots ou candidats. Les nouvelles décisions automatiques restent un journal d'audit et ne sont pas reconverties silencieusement en reviews.

## Preuves attendues

Tests unitaires OEL/Novel, saison V/5, inflexion `return`, ambiguïté, garde manuelle, fournisseur de réconciliation, SQL typé et sweep terminal. Test PostgreSQL avant/après sur décisions, snapshots, candidats et erreurs Graphile. Validation manuelle obligatoire avant tag de wave.
