# Audit sauvegardes, limites API, logique et extension

- Date : 2026-08-02
- Méthode : conformité à `CLAUDE.md` avec preuve locale ; preuve absente = `MANQUE`
- État du dépôt : Wave 0 documentaire, aucun runtime/scaffold applicatif

## Verdict

L'architecture est cohérente après corrections, mais l'application n'est pas encore prouvée en fonctionnement. Sauvegardes, rate limiters, extension MV3, isolation et connecteurs possèdent désormais des gates et scénarios précis ; ils devront être implémentés puis réellement exécutés dans leurs waves. La Wave 0 ne doit jamais être présentée comme une preuve de restauration ou de surveillance réelle.

## Résultats contre la doctrine

| Exigence applicable | Statut | Preuve ou action corrective |
|---|---|---|
| projet privé, local, multi-utilisateur | **CONFORME (conception)** | topologie LAN, invitation fermée, `user_id`, confiance administrateur dans `CLAUDE.md` et [architecture](03-architecture.md) |
| favori comme ancre, sans ajout autonome | **CONFORME (conception)** | une alternative ne crée pas d'œuvre ; dernier favori retiré désactive abonnements/préférences ; scénarios Wave 0 |
| tous les favoris examinés localement, extension en lecture seule | **CONFORME (conception)** | préfiltre avant API, IDs qualifiés et aucun appel bookmark d'écriture prévu dans [sources](04-sources.md) |
| catalogue distinct de la disponibilité | **CONFORME (conception)** | `media`, `release_announcement`, `release_origin` et états `SCHEDULED/ANNOUNCED/AVAILABLE` séparés |
| cache contextualisé sans média tiers | **CONFORME (conception)** | quatre couches, TTL, contexte complet et dernier snapshot valide dans ADR 0008 |
| fallback/changement de domaine sans mutation silencieuse | **CONFORME (conception)** | préférences, santé, variantes, `source_alias`, preuve et validation utilisateur dans ADR 0009 |
| limites fournisseurs versionnées et appliquées | **CONFORME après correction (conception)** | table datée dans [APIs et stack](12-api-fournisseurs-et-stack.md), marge FavLib, `429`, `Retry-After`; quota inconnu = `REVIEW_REQUIRED` |
| MangaUpdates activable avec limite connue | **MANQUE externe** | aucune limite numérique officielle claire trouvée ; production bloquée jusqu'à confirmation |
| limites de chaque site réel | **N/A Wave 0** | aucun domaine réel fourni ; audit obligatoire dans chaque sous-wave Wave 8 |
| service worker MV3 résilient | **CONFORME après correction (conception)** | persistance avant réseau, aucune vérité globale, tâches idempotentes/checkpointées |
| stockage extension borné | **CONFORME après correction (conception)** | quota Chrome 10 Mo, budget FavLib 5 Mio, aucun `unlimitedStorage`, overflow → diagnostic/réconciliation |
| surveillance authentifiée honnête | **CONFORME après correction (conception)** | onglet ouvert séparé du fetch validé ; sinon `WAITING_FOR_VISIT`, aucune fausse absence |
| sauvegarde chiffrée, séparée et restaurable | **CONFORME après correction (conception)** | nocturne + pré-migration, rétention 7/4/6, stockage distinct, checksum, restauration jetable, RPO/RTO non vérifiés avant mesure |
| sauvegarde réellement créée et restaurée | **MANQUE implémentation** | aucun `compose.yaml`, PostgreSQL, script ou CI à ce stade ; gate ajoutée à la Wave 1 |
| isolation Alice/Bob réellement testée | **MANQUE implémentation** | scénarios définis, mais aucune API/base exécutable avant Wave 1 |
| extension réellement installée et testée | **MANQUE implémentation** | WXT/manifest/build absents ; tests prévus Wave 3 |
| connecteur réel et détection réelle | **MANQUE entrée utilisateur** | nécessite premiers domaines et exemples anonymisés, puis sous-wave Wave 8 |
| versions/packages épinglés et lockfile | **N/A avant scaffold** | aucune dépendance installée ; revue obligatoire au début de Wave 1 |
| authentification locale et récupération | **CONFORME après correction (conception)** | bootstrap sans défaut, Argon2id, session opaque, CSRF, invitations et reset dans ADR 0014 |
| export, suppression et restauration | **CONFORME après correction (conception)** | rétentions, workflow idempotent et tombstones de non-résurrection dans ADR 0015 |
| contrat API robuste | **CONFORME après correction (conception)** | erreurs stables, pagination, limites, idempotence et négociation de protocole dans [API](11-api.md) |
| modèle de menace et préparation du plan | **CONFORME après correction (conception)** | frontières/risques dans [modèle de menace](16-modele-de-menace.md), prérequis/preuves dans [préparation](15-preparation-demarrage.md) |

## Vérifications officielles refaites

- [TVmaze](https://www.tvmaze.com/api#rate-limiting) : au moins 20 appels toutes les 10 secondes/IP, `429` et limite plus stricte possible ; données CC BY-SA.
- [AniList](https://docs.anilist.co/guide/rate-limiting) : 90/minute nominal, avertissement temporaire à 30/minute lors de la revue ; fournisseur néanmoins désactivé sans autorisation compatible.
- [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms) : minimum 30 secondes, retard possible, aucune garantie pendant le sommeil ; alarmes importantes à recréer.
- [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage#property-local) : 10 Mo pour `storage.local` sans `unlimitedStorage` ; un dépassement rejette l'écriture.
- [cycle de vie MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-shutdown) : arrêt normal après 30 secondes d'inactivité ; les variables globales sont perdues.
- [Chrome bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) : permission `bookmarks`, IDs propres au profil, événements dédiés ; `onChanged` concerne titre/URL et ne détecte pas une publication distante.
- [PostgreSQL](https://www.postgresql.org/docs/current/backup-dump.html) : `pg_dump` produit un snapshot cohérent et les formats archives se restaurent avec `pg_restore`; seule une restauration contrôle réellement l'artefact FavLib.

## Risques restant avant de pouvoir dire « sûr »

1. restaurer effectivement une sauvegarde Wave 1 et mesurer RPO/RTO ;
2. prouver l'isolation Alice/Bob sur chaque route personnelle ;
3. tester l'extension après suspension, quota plein, Chrome fermé et mise à jour avec file non vide ;
4. qualifier chaque site réel : licence, robots, auth, types de pages, quotas et fixtures ;
5. obtenir une réponse exploitable de MangaUpdates ou garder ce fournisseur désactivé ;
6. exécuter les imports MADB/Wikidata/BnF/NDL sur des sous-ensembles mesurés avant toute montée en volume.
7. exécuter les tests auth/CSRF/idempotence et valider les risques acceptés ;
8. restaurer un backup antérieur à une suppression et prouver l'application des tombstones.

## Gates de validation

- Wave 1 échoue si le dump n'est pas restauré sur une base neuve, si l'isolation/auth échoue ou si un secret apparaît dans les preuves.
- Wave 3 échoue si un événement est perdu silencieusement après suspension/quota/update.
- Wave 4 échoue si une assertion sans provenance entre dans le catalogue durable.
- Wave 6 échoue si une annonce produit une notification disponible sans origine validée.
- Toute sous-wave Wave 8 échoue si méthode, conditions ou limite du domaine ne sont pas documentées.
- Wave 9 échoue si export, suppression, purges ou non-résurrection ne sont pas prouvés.

Les scénarios exécutables plus tard sont centralisés dans [`wave-0.feature`](../fixtures/scenarios/wave-0.feature).
