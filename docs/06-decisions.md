# Décisions actées et points ouverts

## Décisions actées

| Sujet | Décision |
|---|---|
| Utilisateurs | multi-utilisateur dès la V1 |
| Hébergement | local pour le moment |
| Distribution | projet privé |
| Inscription | fermée, par invitation administrateur |
| Entrée | tous les favoris URL du profil appairé |
| Dossier Chrome spécial | non requis |
| Métadonnées | AniList intégré mais non bloquant |
| Ajout manuel | absent du parcours principal |
| Progression | observée sur une page précise rattachée à une œuvre favorite, avec consentement |
| Nouveautés | détectées par le connecteur de la source favorite |
| Lecture/visionnage | ouverture sur le site d'origine |
| Livraison | waves indépendamment testables |
| Préfiltrage | tous les favoris examinés localement, seuls les candidats envoyés |
| Jobs | Graphile Worker sur PostgreSQL |
| Origine locale | `https://favlib.home.arpa` derrière Caddy |
| Confiance | l'administrateur système local peut accéder aux volumes |

## Conséquences techniques

- chaque utilisateur installe l'extension dans chaque profil Chrome pertinent ;
- chaque installation est appairée et révocable ;
- les identifiants de favoris sont qualifiés par installation et utilisateur ;
- une réconciliation locale complète les événements Chrome ;
- les vérifications publiques sont mutualisées entre utilisateurs ;
- la progression, l'inbox et les notifications restent personnelles ;
- le service local multi-machine utilise HTTPS ;
- aucune dépendance directe à l'identité Google n'est nécessaire.
- les sorties ne sont mutualisées qu'avec connecteur/version/URL/locale/région/mode identiques ;
- l'arbre Chrome reste strictement en lecture seule.

## Points à fournir avant la Wave 8

1. Liste des premiers domaines réellement présents dans les favoris.
2. Exemples de favoris : fiche œuvre, chapitre et épisode, avec données privées supprimées.
3. Pour chaque site, comportement attendu quand le favori pointe vers une fiche générale.
4. Langues et éditions à prioriser.
5. Canal de notification préféré.

## Arbitrages qui seront calibrés par les tests

- seuils de matching automatique AniList ;
- fréquence de réconciliation complète ;
- durée de conservation des favoris ignorés avant purge ;
- règle lorsque plusieurs favoris indiquent des positions contradictoires ;
- fréquence de surveillance par type et statut d'œuvre ;
- mode digest ou notification immédiate.

Ces arbitrages ne bloquent pas le socle : ils doivent être mesurés sur les fixtures et les premières sorties plutôt que supposés.
