# Résolution MangaDex et promotion MangaUpdates

Après un `NO_MATCH` MangaUpdates, FavLib interroge l’API officielle MangaDex dans sa lane globale (concurrence 1). Le parseur et le matcher partagés doivent désigner un UUID unique. La fiche détaillée, le payload brut, les variantes localisées, les descriptions, assertions et la couverture sont alors collectés une seule fois ; l’œuvre devient immédiatement visible avec `media_metadata.provider = 'mangadex'`.

Un `links.mu` valide peut promouvoir immédiatement l’identité après vérification de la fiche liée. Sinon, `mangadex_promotion_state` fixe l’échéance au lundi suivant à 03:00 `Europe/Paris`. Le lot groupé utilise l’union des titres source, personnels et MangaDex. Un gagnant MangaUpdates unique devient l’identité publique et ses alias absents sont importés, mais les assertions, descriptions et la couverture MangaDex restent la projection éditoriale.

Les erreurs, limites, absences et ambiguïtés sont reportées au lundi suivant sans invalider la résolution. MangaDex n’est jamais accepté par les endpoints manuels et l’extension ne le contacte pas. L’attribution MangaDex doit être visible avant toute ouverture publique.
