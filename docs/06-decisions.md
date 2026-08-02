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
| Métadonnées | fournisseurs bloqués par défaut ; AniList optionnel après autorisation |
| Socle téléchargeable | releases MADB actuelles + Wikidata filtré + dumps/datasets BnF/NDL compatibles, avec provenance champ par champ |
| IMDb | dataset quotidien non commercial optionnel, isolé et purgeable ; jamais dépendance obligatoire |
| Base coréenne | National Library of Korea prioritaire à qualifier avant tout import massif |
| Calendrier anime | TVmaze candidat V1 après politique CC BY-SA, isolation et attribution |
| Signal manga/manhwa/manhua | MangaUpdates `REVIEW_REQUIRED`, candidat par œuvre favorite avec crédit/cache après confirmation de quota ; sans miroir ni preuve de disponibilité |
| Catalogue | index canonique PostgreSQL multi-alias à provenance autorisée |
| Preuve de sortie | annonce catalogue distincte d'une origine disponible validée |
| Ajout manuel | absent du parcours principal |
| Progression | observée sur une page précise rattachée à une œuvre favorite, avec consentement |
| Nouveautés | détectées par le connecteur d'une source surveillée |
| Lecture/visionnage | ouverture sur le site d'origine |
| Livraison | waves indépendamment testables |
| Préfiltrage | tous les favoris examinés localement, seuls les candidats envoyés |
| Jobs | Graphile Worker sur PostgreSQL |
| Origine locale | `https://favlib.home.arpa` derrière Caddy |
| Confiance | l'administrateur système local peut accéder aux volumes |
| Cache | extension + PostgreSQL + TanStack Query, sans Redis ni média tiers |
| Multi-source | alternatives regroupées par sortie, préférence et fallback explicable |
| Découverte | déclenchée et bornée, Web limité aux domaines approuvés |
| Validation source | recherche = indice ; connecteur + matching fort = preuve |
| Surveillance alternative | après épinglage/fallback accepté, avec favori d'œuvre toujours actif |
| Notifications multi-source | une alerte compatible par défaut, alerte préférée tardive optionnelle |
| Comick | aucun branchement sur une API non documentée ; audit Wave 8 requis |
| Connecteur générique | configuration privée CSS/XPath/regex administrée, versionnée et sans code distant |
| Recherche Web | Brave candidat optionnel ; Google Custom Search JSON refusé |
| Runtime | TypeScript sur Node.js 24 LTS comme cible de scaffold |
| Distribution extension | chargement non empaqueté en test ; Web Store non répertorié ou gestion d'entreprise ensuite |

## Conséquences techniques

- chaque utilisateur installe l'extension dans chaque profil Chrome pertinent ;
- chaque installation est appairée et révocable ;
- les identifiants de favoris sont qualifiés par installation et utilisateur ;
- une réconciliation locale complète les événements Chrome ;
- les vérifications publiques sont mutualisées entre utilisateurs ;
- la progression, l'inbox et les notifications restent personnelles ;
- le service local multi-machine utilise HTTPS ;
- aucune dépendance directe à l'identité Google n'est nécessaire ;
- les sorties ne sont mutualisées qu'avec connecteur/version/URL/locale/région/mode identiques ;
- l'arbre Chrome reste strictement en lecture seule ;
- un fallback ponctuel ne change pas la préférence permanente ;
- les migrations de domaine conservent un alias et une preuve ;
- un titre n'est jamais utilisé comme identifiant unique ;
- les rendus Web interrogent le catalogue local au lieu d'appeler AniList ;
- une annonce de diffusion accélère les checks mais ne prouve pas la disponibilité ;
- retirer le dernier favori désactive tous les abonnements personnels de l'œuvre ;
- ouvrir ponctuellement une alternative ne crée ni préférence ni abonnement ;
- un domaine sans connecteur ne peut pas être surveillé automatiquement ;
- une source privée est best effort et son état hors ligne/périmé reste explicite ;
- une modification des conditions d'un fournisseur suspend ses jobs jusqu'à nouvelle revue.
- une limite fournisseur inconnue interdit tout job planifié ; un prototype manuel ne vaut pas autorisation de production ;
- une sauvegarde n'est saine qu'après déchiffrement, checksum et restauration réussie sur une base neuve ;
- une cible privée sans onglet ouvert ni fetch d'extension validé reste `WAITING_FOR_VISIT` ;
- un dump passe par checksum, staging et activation atomique ; aucune livraison n'écrase directement `media` ;
- deux assertions contradictoires restent traçables et une suppression fournisseur n'efface pas une preuve indépendante.

## Points à fournir avant la sortie de la Wave 1

1. Système et architecture de l'hôte local cible.
2. Mode de résolution de `favlib.home.arpa` sur les appareils clients.
3. Chemin de données autorisé, capacité disponible et destination de backup physiquement distincte.
4. Méthode d'escrow hors hôte de la clé de sauvegarde.
5. Acceptation des durées initiales de session et du modèle de confiance administrateur.

Ces points ne bloquent pas l'écriture du plan ni le développement sur fixtures. Les points 2 à 4 bloquent toutefois la validation d'exploitation réelle de la Wave 1.

## Points à fournir avant la Wave 8

1. Liste des premiers domaines réellement présents dans les favoris.
2. Exemples de favoris : fiche œuvre, chapitre et épisode, avec données privées supprimées.
3. Pour chaque site, comportement attendu quand le favori pointe vers une fiche générale.
4. Langues et éditions à prioriser.
5. Canal de notification préféré.

## Arbitrages qui seront calibrés par les tests

- seuils de matching automatique local ou fournisseur autorisé ;
- fréquence de réconciliation complète ;
- durée de conservation des favoris ignorés avant purge ;
- règle lorsque plusieurs favoris indiquent des positions contradictoires ;
- fréquence de surveillance par type et statut d'œuvre ;
- mode digest ou notification immédiate.

Ces arbitrages ne bloquent pas le socle : ils doivent être mesurés sur les fixtures et les premières sorties plutôt que supposés.

La justification, les conditions et les versions datées sont détaillées dans [12-api-fournisseurs-et-stack.md](12-api-fournisseurs-et-stack.md). Les bases téléchargeables et leur import sont détaillés dans [13-jeux-de-donnees-et-imports.md](13-jeux-de-donnees-et-imports.md).
