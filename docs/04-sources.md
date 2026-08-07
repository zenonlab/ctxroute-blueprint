# Favoris, catalogues et connecteurs

## Chaîne commune

```text
favori HTTP(S)
→ inventaire exhaustif
→ classification locale recognized/review/excluded
→ identité locale provisoire et visible
→ fournisseur canonique selon le type
→ fournisseur image indépendant
→ connecteur du site pour disponibilité/progression
```

Un fournisseur indisponible ne retire jamais une œuvre reconnue. Un titre seul n’est jamais une identité et un candidat ambigu n’est jamais fusionné automatiquement.

## Anime : AniList

AniList est canonique pour l’identité, les titres, synonymes, relations, métadonnées générales et le calendrier anime. Il fournit également couverture et bannière. Les annonces d’airing créent `SCHEDULED`, jamais `AVAILABLE`.

La recherche utilise un payload léger ; la fiche riche est récupérée ensuite par ID. Les réponses sont bornées, espacées par la gate PostgreSQL et persistées avec version, hash et provenance.

## Lecture : MangaUpdates

MangaUpdates est canonique pour manga, manhwa et manhua. Le parcours attendu est :

```text
titre(s) nettoyé(s)
→ POST /v1/series/search
→ results[].record
→ match fort et unique
→ GET /v1/series/{series_id}
→ titre + associated[] + type + année + fiche + statut + dernier chapitre
```

Les titres associés multilingues deviennent des alias avec provenance MangaUpdates. Le statut et le dernier chapitre sont une progression publique de publication, pas la progression personnelle de l’utilisateur.

Le scheduler utilise les endpoints publics MangaUpdates. Une release MangaUpdates crée `ANNOUNCED`; seule une origine constatée par un connecteur devient `AVAILABLE`.

## Images de lecture

AniList fournit les images après résolution d’identité. Une image ne confirme aucune identité et n’alimente aucun champ éditorial.

### Résolution forte et types MangaUpdates

Les types `Manga`, `Manhwa` et `Manhua` sont graphiques. `Novel`, `Light Novel`, `Web Novel` et `Visual Novel` sont toujours rejetés. `OEL` décrit une origine éditoriale et n'est pas suffisant seul : une fiche OEL n'est compatible que si son statut, ses catégories ou ses publications démontrent des chapitres, un webtoon, un webcomic ou un comic. Elle reste soumise au matching exact/scoré et au rejet des fiches mortes.

AniList n'accepte une équivalence de saison arabe/romaine que sur le suffixe final d'une même base (`DanMachi 5`/`DanMachi V`). Les nombres internes au titre ne sont jamais réécrits. Les candidats non uniques restent en review.

Les images sont vérifiées pour HTTPS, MIME réel, taille, dimensions, ratio, décodage et animation avant compression WebP. Un asset actif est dédupliqué par SHA-256. Un refus conserve l’erreur et conduit à la tentative suivante ou à un placeholder, jamais à un asset actif invalide.

## Pages favorites et connecteurs

Les pages favorites restent les sources de lecture/visionnage. Leur connecteur peut canoniser l’URL, observer une position personnelle consentie et constater les sorties disponibles. Il ne remplace aucun fournisseur catalogue et ne transmet aucun chapitre, épisode, cookie ou contenu tiers au serveur.

## Provenance et politiques

Chaque finalité exige une politique `AUTHORIZED` versionnée :

- `anilist`: `anime-identity`, `anime-metadata`, `anime-calendar`, `anime-image`, `reading-image-fallback`;
- `mangaupdates`: `reading-identity`, `reading-metadata`, `reading-releases`;

Une politique absente, expirée ou trop large bloque uniquement la finalité concernée et apparaît dans les diagnostics.
