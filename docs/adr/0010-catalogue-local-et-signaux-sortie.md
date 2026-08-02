# ADR 0010 — Catalogue local et signaux de sortie

- Statut : accepté
- Date : 2026-08-02

## Objectif

Reconnaître une même œuvre malgré ses titres japonais, coréens, chinois, romaji, anglais, français, abréviations et titres propres aux sites, puis détecter correctement un nouvel épisode ou chapitre.

## Décision

FavLib maintient dans PostgreSQL un catalogue canonique local, indépendant des bibliothèques personnelles. Il provient des favoris, connecteurs approuvés, corrections auditées et datasets dont la rétention est explicitement permise. AniList possède un adaptateur remplaçable, optionnel et désactivé jusqu'à validation `AUTHORIZED` selon l'[ADR 0012](0012-conformite-fournisseurs-metadonnees.md).

Le système sépare trois faits :

1. `media` décrit l'œuvre canonique ;
2. `release_announcement` décrit une sortie annoncée ou planifiée par un catalogue ;
3. `release_origin` prouve qu'une sortie est actuellement disponible sur un site inspecté.

Une annonce seule peut alimenter le calendrier ou l'état `ANNOUNCED`, mais seule une origine observée valide produit une notification « disponible sur ce site ».

## Identité et titres

```text
media
  ├─ external_id : ANILIST:123, MAL:456, identifiant éditeur…
  ├─ media_title : native, romaji, anglais, français, synonymes…
  ├─ media_relation : préquelle, suite, saison, adaptation, side story…
  └─ source_media_alias : titre et slug propres à un connecteur
```

Chaque titre conserve texte original, langue, écriture, type, fournisseur, niveau de confiance et dates de validité. L'index de recherche possède une forme normalisée NFKC/casefold, une forme sans ponctuation et un index trigramme. Les accents ou translittérations ne sont jamais supprimés comme donnée source.

Un titre n'est jamais une clé unique. Le matching combine alias, type, pays d'origine, format, année, saison, relations, domaine, URL canonique et éléments fournis par le connecteur. Un homonyme ou un score insuffisant va dans « À vérifier ».

Un alias appris depuis un site n'entre dans le catalogue global qu'après rattachement fort ou confirmation. Une correction personnelle reste personnelle tant qu'elle n'est pas promue par une règle administrateur auditée.

## Synchronisation du catalogue

Les jobs sont idempotents et conservent fournisseur, identifiant, `provider_updated_at`, `fetched_at`, hash de normalisation, version du mapper et politique de rétention applicable.

- nouveau candidat : recherche locale, puis fournisseur seulement s'il est autorisé ;
- œuvre favorite reconnue : enrichissement conforme à la politique de provenance de chaque champ ;
- œuvre anime en diffusion : rafraîchissement quotidien des métadonnées et job calé sur la prochaine diffusion ;
- manga/manhwa/manhua en cours : rafraîchissement quotidien des métadonnées, sans en déduire qu'un chapitre est disponible ;
- œuvre terminée : rafraîchissement hebdomadaire puis espacement progressif ;
- changement de version du mapper : renormalisation depuis les champs canoniques conservés ;
- indisponibilité fournisseur : dernier état valide conservé, backoff et reprise par checkpoint.

Le préchauffage est désactivé pour AniList sans autorisation explicite. Une synchronisation large, un import massif ou un miroir complet requiert un dataset autorisé et un ADR séparé couvrant licence, attribution, rétention, purge et mise à jour.

Après suppression d'un favori, seules restent les métadonnées dont la provenance autorise une conservation indépendante. Le cache fournisseur expire et se purge selon sa politique. `catalog_sync_state` mesure couverture, fraîcheur, erreurs et files restantes afin que la taille du catalogue ne masque pas son niveau réel d'actualisation.

## Détection des sorties

### Anime

Lorsqu'il est autorisé, TVmaze est le calendrier V1 privilégié. FavLib crée ou met à jour une `release_announcement`, planifie une vérification proche de l'horaire annoncé, puis demande aux connecteurs des sites suivis de confirmer une `release_origin`. AniList peut rester un fournisseur remplaçable après autorisation écrite, mais n'est plus nécessaire au parcours V1.

### Manga, manhwa et manhua

Le catalogue donne identité, statut et nombre total lorsqu'il est connu, mais n'est pas considéré comme un calendrier universel de chapitres. Après autorisation, MangaUpdates peut produire un `release_announcement` de type « release déclarée » et accélérer les contrôles. API officielle, RSS ou connecteur du site favori constate toujours la disponibilité effective.

### Déduplication

Annonce et origine sont rattachées à l'identité structurée de l'ADR 0005. Les retries utilisent une clé idempotente `(media_id, sequence_key, release_key, origin_or_provider)` et ne créent ni seconde sortie ni seconde notification.

## Nouvelles saisons et relations

Une suite ou nouvelle saison AniList est généralement un autre `media`. `media_relation` les regroupe dans une franchise, mais FavLib ne l'ajoute pas automatiquement à la bibliothèque. L'interface peut signaler « suite annoncée » sur l'œuvre favorite ; le suivi de cette nouvelle entrée reste soumis aux règles produit liées aux favoris.

## Conséquences

- PostgreSQL sert d'index canonique à provenance autorisée et de cache fournisseur à TTL borné ;
- `pg_trgm` et `unaccent` peuvent être activés par migration pour la recherche, sans devenir l'unique preuve de matching ;
- l'API AniList n'est ni appelée pour chaque rendu Web ni utilisée comme preuve qu'un épisode est lisible sur un site ;
- un second fournisseur pourra compléter les identifiants et alias sans changer le modèle métier.
