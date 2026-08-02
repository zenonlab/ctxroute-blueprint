# ADR 0012 — Conformité des fournisseurs de métadonnées

- Statut : accepté
- Date : 2026-08-02

## Objectif

Construire un catalogue local utile sans transformer une API tierce en sauvegarde, miroir ou source collectée en masse contrairement à ses conditions.

## Décision

Chaque fournisseur possède une politique versionnée avant son activation : usages permis, autorisation obtenue, attribution, rétention, cache maximal, limites, suppression et contact. La configuration applique cette politique ; un simple respect du rate limit ne vaut pas autorisation de stockage.

La revue initiale datée et ses sources sont consignées dans [APIs, fournisseurs et stack vérifiés](../12-api-fournisseurs-et-stack.md). Au 2026-08-02, Wikidata, les contenus MADB couverts par leurs conditions ouvertes et les bibliographies BnF/NDL compatibles sont les candidats du socle durable. TVmaze est candidat pour les annonces anime sous CC BY-SA isolé/attribué ; MangaUpdates est candidat pour les lookups et signaux par œuvre favorite avec crédit/cache, jamais pour un miroir global. AniList, MAL, MangaDex, AnimeSchedule, Kitsu et les autres fournisseurs restent soumis aux restrictions indiquées dans cette matrice. Google Custom Search JSON, Jikan et toute API Comick non documentée sont refusés.

AniList est un adaptateur optionnel et désactivé par défaut tant qu'une autorisation compatible avec FavLib — application privée de suivi, cache et rétention envisagés — n'est pas documentée. Sans cette preuve :

- aucune hydratation durable, synchronisation planifiée ou collecte de masse AniList ;
- aucun préchauffage AniList ;
- aucun appel nécessaire à l'import ou à l'usage normal ;
- les écrans restent fonctionnels avec le catalogue FavLib issu des favoris, des connecteurs validés et des datasets explicitement autorisés.

Si AniList est autorisé, seules les finalités et durées accordées sont activées. Lorsque le cache est permis, les réponses utilisent un TTL borné et une purge par fournisseur ; sinon elles ne sont pas conservées. Leur expiration ne supprime pas l'identité FavLib ni les données provenant d'une autre source autorisée. Une donnée durable conserve une provenance qui prouve que sa licence ou son autorisation permet cette rétention.

## Garde d'activation

Le registre `metadata_provider_policy` contient au minimum :

- `provider`, version des conditions et URL examinée ;
- statut `DISABLED`, `REVIEW_REQUIRED` ou `AUTHORIZED` ;
- finalités, champs, volume et rétention autorisés ;
- date, preuve et auteur de la revue ;
- date de prochaine revue et procédure de purge.
- source/date du quota, fenêtre, marge client, concurrence, budget quotidien et stratégie `Retry-After`.

L'adaptateur refuse démarrage, jobs et préchauffage lorsque la politique n'est pas `AUTHORIZED`. Une limite numérique inconnue empêche aussi l'activation planifiée ; un test manuel borné ne la remplace pas. Une modification des conditions repasse le fournisseur à `REVIEW_REQUIRED`, suspend les jobs et déclenche la purge prévue sans affecter les données personnelles.

## Catalogue durable

Le noyau `media` peut être créé depuis un favori et une inspection fiable même sans fournisseur externe. Titres, alias, identifiants et relations durables doivent pointer vers une provenance autorisée : observation de favori personnelle, connecteur de site approuvé, correction auditée ou dataset sous licence compatible.

Un import massif ou un miroir exige un ADR propre au dataset, sa licence, sa mise à jour, son attribution et sa suppression. La taille du catalogue n'est jamais obtenue en contournant cette gate.

## Tests exigés

- AniList non autorisé : aucun appel, job ou préchauffage n'est possible ;
- passage à `REVIEW_REQUIRED` : jobs suspendus et purge conforme à la politique ;
- suppression du cache fournisseur : l'œuvre favorite et ses preuves indépendantes restent utilisables ;
- donnée durable : chaque champ possède une provenance dont la rétention est permise.

## Conséquences

FavLib peut fonctionner avant toute autorisation AniList. Une grande base locale reste possible à partir de sources et datasets autorisés, sans inventer un droit de collecte ou de conservation.
