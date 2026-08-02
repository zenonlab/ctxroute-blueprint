# Jeux de données, dumps et imports locaux

- Revue : 2026-08-02
- Portée : projet privé, local, multi-utilisateur et non commercial
- Objet : construire une grande base PostgreSQL sans dépendre uniquement d'APIs

## Conclusion

FavLib doit combiner plusieurs bases, car aucune source ne couvre correctement à la fois les alias internationaux, les éditions manga, les anime, les épisodes, les manhwa/manhua et la disponibilité sur les sites de l'utilisateur.

Le socle recommandé est :

```text
releases MADB + sous-ensemble Wikidata + dumps BnF + datasets NDL
                              │
                              ▼
                 catalogue PostgreSQL local
        titres + alias + éditions + relations + identifiants
                              │
                 IMDb non commercial, optionnel
                              │
                              ▼
       matching des favoris et des pages inspectées par connecteur
```

Ces bases reconnaissent une œuvre et ses autres noms. Elles ne prouvent pas qu'un nouveau chapitre ou épisode est disponible sur Comick ou un autre site : cette preuve vient toujours de l'API, du flux ou de la page du site favori, après validation de son connecteur.

## Bases téléchargeables retenues

| Base | Livraison et fraîcheur vérifiées | Apport à FavLib | Licence ou contrainte | Décision |
|---|---|---|---|---|
| [MADB, dépôt officiel](https://github.com/mediaarts-db/dataset) | releases JSON-LD/Turtle généralement mensuelles ; `1.2.18` publiée le 17 juillet 2026 | mangas, séries, magazines, programmes et séries anime japonais | réutilisation secondaire libre annoncée par le dépôt ; attribution/version et droits tiers à conserver | **socle recommandé** |
| [Wikidata](https://www.wikidata.org/wiki/Wikidata:Database_download) | dump JSON/RDF complet hebdomadaire et changements quotidiens | alias multilingues, écritures natives, identifiants et relations | données structurées CC0 | **socle recommandé**, sous-ensemble seulement |
| [data.bnf.fr](https://data.bnf.fr/en/opendata) | dump RDF de la base complète | titres français, œuvres, manifestations, ISBN/EAN, éditeurs et dates | Licence ouverte de l'État pour les métadonnées descriptives, avec source et date de récupération | **socle recommandé** pour les éditions françaises |
| [National Diet Library](https://www.ndl.go.jp/en/dlib/standards/opendataset) | jeux de données téléchargeables, notamment publications japonaises récentes ; MARC disponible séparément | volumes/éditions japonais, titre, série, auteur, éditeur, année, ISBN/ISSN | données ouvertes selon la notice du jeu ; provenance obligatoire | **socle recommandé** pour les éditions japonaises |
| [IMDb Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/) | TSV gzip actualisés chaque jour | titres originaux/localisés, années, formats et structure série/saison/épisode | copies locales permises uniquement pour usage personnel/non commercial, selon des conditions non ouvertes et révocables | **option isolée**, utile aux anime |

### MADB : ne pas utiliser les anciens ZIP par erreur

La [page historique MADB Lab](https://mediag.bunka.go.jp/madb_lab/lod/download/) indique encore une mise à jour au 17 novembre 2023. L'archive anime testée derrière cette page s'arrête au 30 juin 2023, même si son en-tête HTTP a été retouché en 2026.

La source correcte est désormais le [dépôt officiel `mediaarts-db/dataset`](https://github.com/mediaarts-db/dataset/releases). Sa release `1.2.18` contient 66 artefacts JSON-LD/Turtle et couvre notamment :

- `metadata101` : volumes manga ;
- `metadata104` : séries de volumes manga ;
- `metadata201` : programmes TV anime ;
- `metadata207` : séries régulières TV anime ;
- les catégories d'œuvres, responsabilités et données connexes prévues par le schéma MADB.

FavLib importe une release GitHub épinglée et vérifiée, puis utilise le SPARQL MADB uniquement comme delta ou contrôle de fraîcheur. Un changement d'espace de noms MADB est traité par le mapper, jamais par une modification destructive des identités canoniques.

### IMDb : utile mais non canonique

Les fichiers `title.akas`, `title.basics` et `title.episode` sont particulièrement utiles pour reconnaître les variantes régionales d'un anime et relier un épisode à sa série, sa saison et son numéro. IMDb ne possède toutefois pas un type « anime » fiable à lui seul et son dataset public ne donne pas un horaire exact de diffusion.

L'import IMDb est donc :

- désactivé par défaut et soumis à une politique `AUTHORIZED` ;
- conservé dans un schéma/provenance séparé ;
- activable seulement tant que FavLib reste non commercial ;
- purgeable en entier sans supprimer les favoris ou assertions provenant d'autres bases.

## Bases complémentaires étudiées

| Base | Intérêt | Problème ou limite | Décision |
|---|---|---|---|
| [National Library of Korea LOD](https://www.nl.go.kr/NL/contents/N11000000000.do) | catalogue coréen, auteurs, sujets et formes machine-readable JSON/RDF/Turtle/N-Triples ; la bibliothèque annonce aussi un dataset téléchargeable | vérifier la licence exacte du dataset et le filtrage webtoon/manhwa avant import massif | **candidat prioritaire** pour le coréen |
| [Bibliographie nationale coréenne](https://www.nl.go.kr/NL/contents/N50601000000.do?id=42409&schBcid=normal0202&schM=view) | datasets annuels CSV/XLSX/JSON de publications coréennes | surtout volumes et publications déposées, pas chapitres Webtoon | **candidat prioritaire** après revue licence |
| [Open Library](https://openlibrary.org/developers/dumps) | dumps mensuels œuvres, éditions, auteurs, redirections et suppressions ; ISBN internationaux | les droits des contributions peuvent varier et la classification manga est irrégulière | **appoint en quarantaine**, jamais vérité unique |
| [Grand Comics Database](https://www.comics.org/) | séries, numéros et histoires de comics ; données annoncées sous CC BY-SA | ShareAlike à isoler ; couverture manga/manhwa inégale ; images de couverture hors réutilisation libre | **candidat comics/éditions**, pas V1 |
| [Library of Congress bulk data](https://www.loc.gov/item/prn-21-047/library-of-congress-releases-data-for-free-download-and-discovery/2021-09-01/) | éditions anglaises/américaines, autorités et identifiants | filtrage et droits à vérifier jeu par jeu ; redondant en V1 | **faible priorité** |
| [AniDB anime title dump](https://wiki.anidb.net/API#Data_Dumps) | dump quotidien compact des titres et synonymes anime vers un identifiant AniDB | finalité client-side documentée, mais licence/rétention globale insuffisamment explicites | **lookup optionnel après accord**, pas import durable actuel |
| [anime-offline-database](https://github.com/manami-project/anime-offline-database) | gros fichier de correspondances anime multi-fournisseurs | projet archivé en juillet 2026 et contraintes ODbL/DbCL/ShareAlike à traiter | **seed historique seulement après ADR licence** |
| [Anime-Lists/anime-lists](https://github.com/Anime-Lists/anime-lists) | mappings AniDB/TVDB/IMDb utiles pour les saisons | aucun fichier de licence détecté lors de la revue | **refusé pour import** tant qu'une licence n'est pas publiée |

Les CSV Kaggle, dumps de sites aspirés, listes sans provenance et datasets académiques d'images comme Manga109 ne sont pas intégrés. Ils sont soit figés, soit sans licence de base exploitable, soit centrés sur les pages/images que FavLib ne doit ni stocker ni redistribuer.

### Ce qui ressemble à un dump mais n'en est pas un

- les [exports quotidiens TMDB](https://developer.themoviedb.org/docs/daily-id-exports) sont explicitement des listes d'identifiants valides, pas des exports complets ; il faudrait encore appeler l'API pour chaque fiche ;
- AniList expose une API GraphQL, mais aucun dump officiel réutilisable compatible avec le miroir local envisagé n'a été trouvé ;
- Jikan n'est pas une base indépendante : il renvoie des données MAL scrapées et ne transmet aucun droit sur ces données ;
- le code open source d'un serveur MangaDex/Kitsu ou d'un scraper ne donne pas la licence de sa base de production ;
- une archive communautaire « complète » sans provenance reste refusée, même si son téléchargement est techniquement facile.

## Ce que chaque famille résout

| Besoin | Base locale | Signal vivant complémentaire |
|---|---|---|
| même anime sous plusieurs noms | MADB + Wikidata + IMDb optionnel | alias extrait du connecteur du site |
| volume/édition manga française | BnF | connecteur librairie/site suivi si nécessaire |
| volume/édition manga japonaise | NDL + MADB | publication/catalogage récent NDL |
| manhwa coréen et ses éditions | NLK après autorisation + Wikidata | MangaUpdates à la demande et connecteur favori |
| saison et numérotation d'un anime | MADB + IMDb optionnel | TVmaze pour l'annonce ; connecteur pour la disponibilité |
| nouveau chapitre ou épisode sur un site précis | aucune base catalogue ne suffit | API/RSS/JSON/HTML/extension privée du site |
| changement de domaine/source | URL et alias historiques locaux | redécouverte bornée, inspection puis validation utilisateur |

## Pipeline d'import dans PostgreSQL

Un dump n'écrit jamais directement dans `media`. Chaque import suit ce flux :

```text
manifest fournisseur/version/licence
  → téléchargement temporaire borné
  → checksum + taille + type + contrôle ZIP
  → staging brut propre au fournisseur
  → validation du schéma et quarantaine des rejets
  → assertions normalisées avec provenance champ par champ
  → résolution vers media / media_title / external_id / relation
  → rapport de couverture, conflits et ambiguïtés
  → activation atomique du nouveau batch
```

Tables minimales supplémentaires :

| Table | Rôle |
|---|---|
| `dataset_release` | fournisseur, version, URL, date, licence revue et statut |
| `dataset_artifact` | nom, format, taille attendue, checksum, ETag et date serveur |
| `dataset_import_run` | état, checkpoint, compteurs, mapper et durée |
| `provider_record` | identifiant brut, payload JSONB utile, hash et batch actif |
| `metadata_assertion` | sujet, champ, valeur, fournisseur, record, confiance et validité |
| `dataset_reject` | record invalide, raison bornée et version du validateur |

### Règles de fusion

- une valeur nouvelle ajoute une assertion ; elle n'écrase pas silencieusement une autre source ;
- identifiant externe exact + type compatible constitue la meilleure clé de rattachement ;
- un titre seul, même exact, ne fusionne jamais deux œuvres ;
- les alias restent rattachés à leur langue, écriture, région et provenance ;
- œuvre, adaptation, saison, édition et volume sont des entités ou relations distinctes ;
- suppression/redirection d'un fournisseur désactive son assertion sans effacer une preuve indépendante ;
- tout conflit année/type/relation va dans une file administrateur explicable.

### Sécurité et exploitation

- limites de taille compressée/décompressée, nombre de fichiers et ratio de compression ;
- téléchargement avec timeout, reprise et allowlist exacte des hôtes officiels ;
- archive et chemin interne normalisés pour bloquer ZIP Slip ;
- espace disque vérifié avant import ;
- staging supprimable après activation, selon la politique du fournisseur ;
- aucun dump tiers, favori réel ou cache brut ajouté à Git ;
- import précédent conservé comme pointeur de rollback, puis purgé selon rétention ;
- l'interface affiche version active, fraîcheur, licence, attribution, rejets et dernier succès.

## Cadence recommandée

| Source | Cadence FavLib | Méthode |
|---|---|---|
| MADB | surveiller les releases chaque semaine ; importer seulement une nouvelle version | release épinglée + checksum, SPARQL borné pour delta/contrôle |
| Wikidata | bootstrap filtré, changements quotidiens ou consolidation hebdomadaire | dump officiel + incrémentaux, jamais dump complet chargé dans PostgreSQL |
| BnF | mensuelle au départ | nouveau dump/sous-ensemble d'éditions pertinentes |
| NDL | hebdomadaire pour l'année récente, consolidation annuelle | dataset de l'année récente + identifiants stables |
| IMDb optionnel | quotidien ou hebdomadaire selon espace disque | remplacement atomique des TSV utiles |
| NLK futur | mensuelle/annuelle selon publication officielle | dataset et deltas seulement après politique `AUTHORIZED` |
| Open Library futur | mensuelle | œuvres/éditions filtrées, redirections et suppressions comprises |

Un import périodique met à jour la connaissance du catalogue. Les vérifications de sorties restent planifiées par œuvre favorite et par connecteur ; la taille de la base ne doit jamais provoquer le scraping de tout Internet.

## Ordre d'implémentation et tests

La Wave 4 procède par sous-sorties testables :

1. schéma d'imports + importeur du [manifest synthétique](../fixtures/catalog/wave-0.dataset-manifest.json) et de ses records NDJSON ;
2. MADB séries manga/anime, sur un petit artefact épinglé ;
3. sous-ensemble Wikidata lié aux identifiants connus ;
4. BnF/NDL pour les éditions ;
5. IMDb derrière feature flag si sa politique non commerciale est approuvée ;
6. NLK seulement après preuve de licence et prototype de filtrage coréen.

Pour chaque sortie : import à blanc, import réel, second import idempotent, interruption/reprise, rollback du batch, contrôle des conflits et preuve qu'aucune bibliothèque personnelle n'a été créée par le dataset.

## Décision opérationnelle

Le premier catalogue volumineux de FavLib sera construit avec MADB + Wikidata filtré + BnF/NDL. IMDb est une couche anime optionnelle et juridiquement isolée. NLK est la prochaine base à qualifier pour les titres coréens. Open Library, GCD, AniDB et les projets GitHub communautaires ne bloquent pas la V1.

La matrice des APIs et signaux vivants reste dans [12-api-fournisseurs-et-stack.md](12-api-fournisseurs-et-stack.md). La conformité des fournisseurs suit l'[ADR 0012](adr/0012-conformite-fournisseurs-metadonnees.md).
