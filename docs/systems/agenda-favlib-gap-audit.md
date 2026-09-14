# Audit Agenda FavLib → TobiRink

## Verdict initial

L'Agenda TobiRink possède désormais une route v2, un chargeur HTTP, une
projection et des alarmes, mais la chaîne ne peut toujours pas produire un
Agenda complet. La production sert `entries: []`. Le collecteur AniList du
Worker est manuellement bloqué par l'amont avec HTTP 403, ne lit que la
première page de 50 sorties, et le collecteur MangaUpdates retourne toujours
un tableau vide.

L'audit du 13 septembre 2026 invalide donc la certification précédente. Le
cache présenté comme IndexedDB est encore `storage.local`, le client ne suit
pas `nextCursor`, les occurrences civiles sont éliminées, et le nom de
fournisseur `mangaUpdates` ne correspond pas à la référence canonique locale
`mangaupdates`.

## Ce qui est déjà correct

- IndexedDB reste l'autorité privée des Works, progressions, rappels et tâches.
- Le site passe par WebBridge et ne possède pas de binding D1.
- Le Worker possède les bindings Cloudflare et les requêtes D1 existantes sont
  préparées et bornées.
- Le snapshot R2 v1 est strict et versionné.
- Les rappels estimés sont déjà exclus du planificateur natif.
- `storage.sync` est réservé au snapshot d'identifiants fournisseurs.
- Une panne d'une lane ne fait plus échouer le cron global et son diagnostic
  amont borné est conservé.

## Écarts bloquants constatés

1. Le Worker reçoit `anilist-403: You have been manually blocked` malgré une
   seule requête toutes les cinq minutes; le problème est son egress, pas le
   quota de 30 requêtes par minute.
2. La requête AniList fixe `page: 1` et `perPage: 50`, sans `pageInfo` ni
   checkpoint; toute fenêtre supérieure à 50 sorties est tronquée.
3. `MangaUpdatesReleaseCollector.collect()` est un stub vide.
4. MangaUpdates ne fournit aucune heure réelle de publication. Son
   `release_date` est une date civile et `time_added` est seulement l'heure
   d'enregistrement dans sa base.
5. Une réponse live à `POST /v1/releases/search` a annoncé 466 résultats et
   `per_page: 40` malgré une demande `perpage: 100`. FavLib calcule encore la
   terminaison avec 100 et peut donc arrêter la pagination trop tôt.
6. Le contrat Agenda utilise `mangaUpdates`, tandis que les `Work` utilisent
   `mangaupdates`; la jointure par fournisseur échoue.
7. `sequence` est un entier, alors que MangaUpdates retourne aussi des valeurs
   comme `58.5`, `2a` et `29-29.5 (end)`.
8. `projectLocalAgenda` et `HttpPublicReleaseLoader` éliminent toutes les
   occurrences `DATE`; aucun manga ne peut apparaître.
9. `AgendaEntry` ne représente qu'un `occursAt` instantané et ne peut conserver
   une date civile sans fabriquer minuit UTC.
10. Le cache public est `tobirink.public-releases.v1` dans `storage.local`,
    hors de l'autorité transactionnelle IndexedDB.
11. Le chargeur demande une seule page de 100 et ignore `nextCursor`.
12. Le snapshot local est borné à 200 entrées, valeur incompatible avec une
    fenêtre AniList/MangaUpdates complète.
13. L'ETag construit par le client ne correspond pas à celui de la route v2.
14. Le test censé vérifier le 304 utilise un snapshot frais : il retourne avant
    le fetch et n'exerce donc jamais son assertion d'en-tête.
15. La pagination D1 est ordonnée par `id` alors que le contrat annonce une
    occurrence puis une clé stable.
16. La révision `d1-${rows.results.length}` ne représente ni une génération ni
    un digest de contenu et peut rester identique après une mutation.
17. Les prédictions manga existent isolément mais ne reçoivent aucun historique
    réel MangaUpdates.
18. Le cron toutes les cinq minutes répète une fenêtre identique; il ne répare
    ni l'egress bloqué ni l'absence de pagination.
19. Aucune génération multipage complète n'est validée avant publication.
20. Aucun test installé ne prouve un Agenda anime et manga non vide après
    perte d'IndexedDB.

## Référence FavLib retenue

FavLib ADR 0088 reste l'oracle comportemental pour la fenêtre commune J−1/J+15,
les pages complètes, ETag, commit atomique, dernier snapshot valide, jointure
par IDs, historique MangaUpdates, prédiction bornée, alarmes stables et
notifications revendiquées. Sa formule de pagination MangaUpdates n'est pas
reprise : TobiRink doit utiliser `page`, `per_page` et `total_hits` réellement
renvoyés par l'API.

La collecte partagée doit être exécutée depuis un egress AniList vérifié, puis
transmettre un lot public signé au Worker. Le Worker reste l'unique auteur D1.
Tant que cette collecte est indisponible, l'extension utilise les mêmes
opérations publiques en repli local durable, sans envoyer ses favoris ni sa
liste d'identifiants au serveur.

La base FavLib privée n'est pas copiée, exportée, journalisée ou utilisée dans
les tests. Les validations utiliseront des fixtures anonymisées et
synthétiques.

## État corrigé et équivalence

La correction remplace les vingt écarts ci-dessus par une chaîne exécutable :
pagination complète des deux fournisseurs, checkpoint par page, génération
atomique IndexedDB, jointure locale canonique, projection `DATE | INSTANT` et
prédiction manga bornée. Le corpus synthétique reproduit 1 501 sorties AniList
en pages de 50 et 466 sorties MangaUpdates en pages de 40. Chaque appel reprend
avec une nouvelle instance du source MV3 et la promotion finale contient 1 967
identités uniques.

| Comportement FavLib | Décision TobiRink | Classement |
| --- | --- | --- |
| Fenêtre civile J−1/J+15 | Conservée | équivalent |
| AniList `pageInfo.hasNextPage`, 50 par page | Conservé avec checkpoint durable et cadence 2,2 s | équivalent renforcé |
| MangaUpdates paginé | `page`, `per_page` et `total_hits` reçus font autorité | correction volontaire |
| `release_date` manga | Conservé comme `DATE`, sans heure issue de `time_added` | équivalent renforcé |
| Historique 12 observations, 8 intervalles | Conservé; intervalle normalisé quand des chapitres sont sautés | correction volontaire |
| Statut terminé/annulé bloque la prédiction | Le statut éditorial hydraté bloque `COMPLETED` et `CANCELLED`; statuts inconnus restent conservateurs | équivalent renforcé |
| Projection locale par identifiant fournisseur | Conservée avec alias historique `mangaUpdates` normalisé | équivalent renforcé |
| Appels fournisseurs directs | Repli MV3 seulement; génération D1 commune prioritaire | amélioration d'efficacité |
| Export ICS mentionné dans la roadmap | Aucun code FavLib à porter; aucune promesse TobiRink | absence historique expliquée |

Aucune différence non classée ne reste dans le périmètre Agenda. La base
privée FavLib n'a pas été ouverte; les nombres publics constatés sont reproduits
uniquement par des événements synthétiques sans titre ni URL utilisateur.
