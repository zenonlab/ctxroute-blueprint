# APIs, fournisseurs et stack vérifiés

- Revue : 2026-08-02
- Portée : projet privé, local, multi-utilisateur et non commercial
- Règle : les conditions et versions sont revérifiées au scaffold puis avant chaque activation réelle

## Conclusion

FavLib n'a besoin d'aucune API Google pour lire les favoris. L'extension utilise `chrome.bookmarks` dans le profil courant. AniList n'est pas indispensable à la V1 : un socle durable Wikidata + MADB + bibliographies nationales peut être complété par TVmaze pour les annonces anime et MangaUpdates pour les signaux manga/manhwa/manhua. Les sorties disponibles restent constatées par le connecteur de chaque site ; aucune API catalogue universelle ne prouve qu'un épisode ou chapitre est lisible partout.

Les sources téléchargeables et leur architecture d'import sont détaillées séparément dans [Jeux de données, dumps et imports locaux](13-jeux-de-donnees-et-imports.md). En particulier, MADB doit être téléchargé depuis ses releases GitHub actuelles et non depuis l'ancienne page de ZIP 2023.

## Matrice des APIs et datasets

| Fournisseur | Usage FavLib | Décision au 2026-08-02 | Clé/compte | Conservation |
|---|---|---|---|---|
| [Chrome Bookmarks](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) | inventaire des favoris du profil | autorisé par permission utilisateur | aucune clé | données personnelles FavLib selon le cycle du favori |
| [Wikidata](https://www.wikidata.org/wiki/Help:Data_access) | titres multilingues, identifiants et relations | socle durable recommandé, données CC0 | aucune clé | autorisée avec provenance ; attribution recommandée |
| [MADB dataset](https://github.com/mediaarts-db/dataset) | manga et animation japonais via releases JSON-LD/Turtle et SPARQL | socle durable recommandé ; releases versionnées actuelles | aucune clé | réutilisation annoncée comme libre par le dépôt ; version, attribution et droits tiers conservés |
| [BnF Catalogue général](https://api.bnf.fr/fr/api-sru-catalogue-general) | éditions françaises, ISBN, éditeurs et dates de publication | socle durable recommandé sous Licence ouverte de l'État | aucune clé | autorisée avec provenance ; les notices ne sont pas un flux instantané de sortie |
| [National Diet Library](https://www.ndl.go.jp/en/use/api) | éditions et publications japonaises, JPNO/ISBN | candidat durable via jeux de données ouverts ; vérifier si l'API choisie exige une demande | selon service | données bibliographiques ouvertes utilisables avec provenance ; latence de dépôt/catalogage possible |
| [TVmaze](https://www.tvmaze.com/api) | épisodes, dates de diffusion et calendrier Web/TV anime | candidat prioritaire pour les annonces anime ; isoler et attribuer les données CC BY-SA avant `AUTHORIZED` | aucune clé pour l'API publique | cache permis ; attribution et ShareAlike obligatoires, 20 appels/10 s/IP à la date de revue |
| [MangaUpdates](https://api.mangaupdates.com/) | catalogue manga/manhwa/manhua, alias, types, chapitres signalés et RSS de sorties | candidat prioritaire mais `REVIEW_REQUIRED` : crédit/cache prévus, limite numérique et licence de base non publiées clairement lors de la revue | fonctions publiques sans compte | aucun job réel avant politique confirmée ; jamais de miroir massif |
| [AniList](https://docs.anilist.co/guide/terms-of-use) | matching, alias et annonces anime | `REVIEW_REQUIRED` : tracker concurrent et stockage/collecte de masse interdits sans accord | API publique ; OAuth inutile pour les seules métadonnées publiques | aucune rétention ou activation avant autorisation écrite compatible |
| [MyAnimeList](https://myanimelist.net/static/apiagreement.html) | enrichissement et identifiants complémentaires | `REVIEW_REQUIRED` : enregistrer l'application, accepter l'accord et obtenir un Client ID | Client ID obligatoire | ne pas utiliser comme base durable sans validation précise de la rétention et de la purge |
| [MangaDex](https://gitlab.com/mangadex-pub/mangadex-api-docs) | connecteur MangaDex, alias et sorties de ce site | candidat Wave 8, jamais miroir global | lecture publique selon endpoints | snapshots minimaux seulement après revue des conditions du site |
| [AnimeSchedule](https://animeschedule.net/api-terms-of-use) | horaires et annonces anime | `REVIEW_REQUIRED` : compilation systématique interdite sans permission écrite | application/secret | aucune base compilée sans accord ; 120 requêtes/minute par IP et application à la date de revue |
| [Brave Search API](https://brave.com/search/api/) | découverte ponctuelle sur domaines approuvés | candidat recommandé et optionnel | compte, abonnement et clé | hints courts seulement ; ne jamais envoyer chemins de favoris ou données personnelles |
| [Google Custom Search JSON API](https://developers.google.com/custom-search/v1/overview) | découverte Web | refusé : fermé aux nouveaux clients et arrêt annoncé au 2027-01-01 | indisponible pour nouveau projet | sans objet |
| [Kitsu anime](https://kitsu.io/api/edge) | métadonnées anime/manga | `REVIEW_REQUIRED` : API active mais politique de rétention insuffisamment claire | endpoints publics | aucune hydratation durable avant clarification |
| [National Library of Korea ISBN API](https://www.nl.go.kr/NL/contents/N31101030500.do) | éditions coréennes et dates de publication prévues | `REVIEW_REQUIRED` : utile pour les volumes coréens, pas pour les épisodes Webtoon | compte, clé et approbation | aucune activation avant revue des conditions de réutilisation |
| [Open Library](https://openlibrary.org/developers/api) | ISBN et éditions de livres en lookup ponctuel | appoint seulement : API orientée usages publics, humains et faible volume, pas backend tiers | aucune clé, user-agent/contact requis | cache raisonnable ; dumps mensuels à étudier séparément, droits de contributions potentiellement ambigus |
| [TMDB](https://www.themoviedb.org/api-terms-of-use) | dates d'épisodes, identifiants et métadonnées anime | fallback `REVIEW_REQUIRED`, TVmaze est préférable pour le calendrier libre | compte et clé | attribution et restrictions des contenus TMDB ; pas de socle durable sans politique précise |
| [TheTVDB](https://thetvdb.com/api-information) | épisodes et correspondances TV | fallback `REVIEW_REQUIRED`, inscription projet et attribution requises | compte et clé | licence limitée/révocable ; ne pas fusionner durablement sans politique |
| [AniDB](https://wiki.anidb.net/API) | titres et identifiants anime | appoint potentiel : dump quotidien des titres, API stricte et anti-miroir | client enregistré selon API | cache lourd requis ; pas de copie globale hors dump explicitement proposé et revue de licence |
| [Simkl](https://docs.simkl.org/how-to-use-simkl/for-developers/how-to-register-an-app) | calendrier et épisodes anime | fallback `REVIEW_REQUIRED`, ne couvre pas manga/manhwa | compte et client ID | rétention/redistribution à clarifier avant activation |
| [Jikan](https://jikan.moe/#integrations) | proxy non officiel de données MAL et wrappers communautaires multi-langages | refusé comme fournisseur FavLib : les « intégrations » sont des clients logiciels, pas une autorisation MAL ; Jikan scrape MAL et renvoie la responsabilité à l'utilisateur | aucune clé | aucune collecte ou rétention de données MAL via Jikan |
| [anime-offline-database](https://github.com/manami-project/anime-offline-database) | seed et correspondances inter-fournisseurs | refusé comme source principale : projet archivé en juillet 2026 et obligations ODbL/DbCL | téléchargement GitHub | import éventuel seulement après ADR licence/share-alike ; aucune mise à jour future supposée |
| Comick | changement rapide de source | aucune API non documentée ; connecteur seulement après revue Wave 8 | inconnue | aucune collecte avant méthode autorisée |

Une API techniquement publique n'est pas automatiquement exploitable comme base locale. Le registre et la gate de l'[ADR 0012](adr/0012-conformite-fournisseurs-metadonnees.md) s'appliquent à chaque fournisseur.

## Limites opérationnelles vérifiées

| Service | Limite fournisseur ou plateforme au 2026-08-02 | Limite FavLib | Réaction obligatoire |
|---|---|---|---|
| [TVmaze](https://www.tvmaze.com/api#rate-limiting) | au moins 20 appels/10 s/IP ; limite temporairement plus stricte possible | 1 appel/s moyen, concurrence 2 maximum pour ce fournisseur | `429` suspend le bucket, backoff avec jitter ; User-Agent propre ; connexions réutilisées/fermées |
| [AniList](https://docs.anilist.co/guide/rate-limiting) | 90 requêtes/minute nominales, mais état dégradé affiché à 30/minute lors de la revue | zéro tant que non `AUTHORIZED`; ensuite limite apprise des headers, avec marge de 20 % | respecter `Retry-After`, `X-RateLimit-Remaining` et `X-RateLimit-Reset` |
| [AnimeSchedule](https://animeschedule.net/api-terms-of-use) | 120 requêtes/minute par IP **et** application à la date de revue | zéro sans permission écrite compatible | aucune compilation systématique ; `429`/quota suspendent les jobs |
| MangaUpdates | aucune limite numérique officielle exploitable trouvée et aucun header de quota observé lors du contrôle | zéro en production avant confirmation ; prototype manuel au plus 1 appel/s | cache, lookup par favori seulement, arrêt immédiat sur `429`; absence de chiffre = gate, pas quota inventé |
| Brave Search | quota et coût dépendants du plan actif | budget quotidien/mensuel administrateur, zéro sans clé | arrêter avant dépassement, aucune bascule silencieuse vers Google |
| connecteurs de sites | propre à chaque domaine, conditions/robots souvent sans quota chiffré | concurrence 1/domaine ; contrôle normal 6–12 h/cible ; découverte bornée à son budget | `Retry-After`, backoff exponentiel, circuit breaker et feature flag par domaine |
| [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms) | au plus une exécution toutes les 30 s et retard arbitraire possible ; le sommeil ne réveille pas l'appareil | une alarme coarse, jamais une alarme par œuvre | échéances serveur, reprise au réveil, état périmé visible |
| [Chrome storage.local](https://developer.chrome.com/docs/extensions/reference/api/storage#property-local) | 10 Mo sans `unlimitedStorage` | budget total FavLib 5 Mio | mesurer `getBytesInUse`, traiter chaque rejet, conserver les non-acquittés et forcer une réconciliation |
| [service worker MV3](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#idle-shutdown) | arrêt normal après 30 s d'inactivité ; événement/API >5 min ou réponse fetch >30 s problématique | aucune vérité en variable globale ; tâches courtes/checkpointées | persister avant réseau, upload idempotent et reprise après réveil |

Ces plafonds FavLib sont volontairement inférieurs aux limites publiées. Ils sont de la configuration de sécurité, pas une affirmation sur le fournisseur. Chaque politique enregistre source/date du quota, unité, fenêtre, concurrence, marge, `Retry-After`, budget journalier et prochaine revue. Une limite inconnue place le fournisseur à `REVIEW_REQUIRED`.

### Pourquoi les intégrations Jikan ne changent pas la décision

La section « Integrations » de Jikan liste des wrappers communautaires pour JavaScript, TypeScript, Python, Java, Go et d'autres langages. Elle facilite l'appel HTTP mais ne constitue ni un partenariat de données, ni une licence accordée par MyAnimeList. Jikan se présente lui-même comme une API non officielle qui scrape MAL, précise qu'il n'est pas affilié et rend chaque utilisateur responsable du respect des conditions MAL.

Les [conditions générales MAL](https://myanimelist.net/about/terms_of_use) n'autorisent pas l'extraction sans consentement préalable et interdisent notamment l'agrégation de leur contenu ailleurs. L'[accord de l'API officielle MAL](https://myanimelist.net/static/apiagreement.html) interdit explicitement scraping, harvesting et extraction en dehors de l'API officielle. La licence MIT de Jikan couvre son code, pas les données MAL qu'il renvoie. Jikan peut rester une référence de schéma ou un outil manuel de développement sur données synthétiques, mais il n'est pas activé dans FavLib.

## Stratégie catalogue

```text
Wikidata CC0 + releases MADB réutilisables
  → seed durable à provenance champ par champ
  → favoris et connecteurs approuvés ajoutent alias propres aux sites
  → correction ambiguë auditée
  → fournisseur privé optionnel seulement si AUTHORIZED
```

Wikidata apporte les alias internationaux mais reste incomplet. MADB et la NDL renforcent le japonais ; la BnF renforce les éditions françaises. MangaUpdates est la meilleure piste trouvée pour reconnaître ensemble manga, manhwa et manhua, mais son API doit être interrogée par œuvre favorite avec cache et crédit, pas aspirée pour fabriquer un miroir. Les connecteurs des sites présents dans les favoris restent nécessaires. Une grande base supplémentaire devra provenir d'un dataset dont licence, attribution, rétention et mises à jour sont explicitement compatibles.

### Remplacement pratique d'AniList en V1

```text
identité et alias durables       → Wikidata + MADB + BnF + NDL
matching manga/manhwa/manhua     → MangaUpdates à la demande + alias des connecteurs
annonces d'épisodes anime        → TVmaze CC BY-SA
publication de volumes           → BnF / NDL / bibliothèque coréenne si autorisée
disponibilité sur un site précis → API/RSS/page du site favori, validée par son connecteur
```

Ce montage remplace la majorité des besoins V1 d'AniList sans créer une dépendance centrale. Il reste moins riche pour les affiches, descriptions éditoriales et certaines relations de franchise ; ces champs sont facultatifs et ne doivent jamais bloquer le suivi.

## Stratégie sorties et disponibilité

- annonce catalogue : calendrier seulement ;
- épisode TVmaze : diffusion annoncée, jamais disponibilité de lecture/streaming déduite ;
- chapitre MangaUpdates : signal qu'une release a été déclarée, puis validation sur les sources compatibles de l'utilisateur ;
- API/RSS/JSON-LD du site : méthode prioritaire pour constater une sortie ;
- page publique : worker serveur mutualisé ;
- page authentifiée : extension privée best effort selon l'[ADR 0013](adr/0013-surveillance-extension-privee.md) ;
- recherche Brave : découverte bornée, jamais preuve de disponibilité ;
- nouvelle origine : déduplication vers une sortie logique puis notification personnelle.

Le favori Chrome ne détecte pas une modification distante de la page. `bookmarks.onChanged` se déclenche uniquement lorsque l'utilisateur modifie le titre ou l'URL du favori. Le favori définit donc le périmètre et la source ; le worker ou l'extension doit toujours vérifier la cible pour découvrir une nouvelle sortie.

## Langages

| Couche | Langage ou format |
|---|---|
| Web, API, worker, contrats et extension | TypeScript strict |
| Interface | React TSX, HTML et CSS/Tailwind |
| Base et migrations | SQL généré/revu via Drizzle |
| Reverse proxy | Caddyfile |
| Déploiement | YAML Docker Compose |
| Contrat HTTP | OpenAPI JSON/YAML généré depuis Zod |
| Fixtures métier | JSON, HTML synthétique et Gherkin |

Aucun second backend Python, Java ou Go n'est nécessaire en V1. Caddy reste un binaire d'infrastructure séparé.

## Frameworks et versions cibles

Versions stables observées le 2026-08-02, à revérifier et épingler exactement lors du scaffold :

| Domaine | Choix | Cible observée | Licence |
|---|---|---|---|
| runtime | [Node.js](https://nodejs.org/en/about/previous-releases) | 24 LTS | MIT |
| workspaces | pnpm + Turborepo | pnpm 11 / Turborepo 2 | MIT |
| Web | [Next.js](https://nextjs.org/docs/app/getting-started/installation) + React | Next.js 16 / React 19 | MIT |
| API | Fastify + Zod | Fastify 5 / Zod 4 | MIT |
| extension | [WXT](https://wxt.dev/guide/installation.html) + Manifest V3 | WXT 0.21 | MIT |
| données | PostgreSQL + Drizzle ORM | PostgreSQL 18 / Drizzle 0.45 stable | PostgreSQL / Apache-2.0 |
| jobs | [Graphile Worker](https://worker.graphile.org/docs/requirements) | 0.17 | MIT |
| UI | Tailwind CSS + shadcn/ui | Tailwind 4 / shadcn 4 | MIT |
| état client | TanStack Query | 5 | MIT |
| tests | Vitest + Playwright | Vitest 4 / Playwright 1 | MIT / Apache-2.0 |
| réseau local | Caddy | 2.11 | Apache-2.0 |
| orchestration | Docker Compose | plugin actuel, pas le standalone legacy | Apache-2.0 |

Node.js 24 LTS est le dénominateur recommandé : Next.js exige au moins Node 20.9, WXT au moins Node 22 et Graphile Worker actuel au moins Node 22.18. PostgreSQL 18 est supporté jusqu'en novembre 2030 selon la [politique PostgreSQL](https://www.postgresql.org/support/versioning/).

Drizzle 1.0 ne doit pas être pris en RC pour la baseline. La dernière version stable compatible est choisie au scaffold, puis migrations et restauration sont testées avant toute mise à jour.

## Infrastructure locale

```text
profil Chrome + extension WXT
          │ HTTPS local
          ▼
Caddy :443 / CA interne
   ├─ /api/* → Fastify
   └─ /*      → Next.js
                    │
            PostgreSQL 18
              ├─ données
              ├─ caches autorisés
              └─ Graphile Worker
```

- Web, API et worker utilisent la même version Node et les mêmes contrats TypeScript ;
- PostgreSQL reste le seul stockage serveur et la seule file durable ;
- aucun Redis en V1 ;
- seuls Caddy et le port HTTPS choisi sont exposés au LAN ;
- la racine publique Caddy est installée sur chaque appareil ;
- l'extension reste hors Docker et s'installe dans chaque profil Chrome.

## Distribution de l'extension

Pour les tests, chaque utilisateur charge le build non empaqueté depuis `chrome://extensions` en mode développeur. L'ID de l'extension doit rester stable pour l'appairage, les scopes et les règles réseau.

Pour une distribution privée durable :

1. chargement manuel non empaqueté pour le petit cercle de test ;
2. publication Chrome Web Store non répertoriée si plusieurs utilisateurs doivent recevoir des mises à jour ;
3. politique d'entreprise seulement pour des appareils administrés.

Chrome bloque largement l'installation automatique d'un CRX auto-hébergé sur Windows et macOS ; voir les [méthodes officielles de distribution](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions). Les permissions de sites restent optionnelles et demandées au moment d'activer un connecteur, conformément à [`chrome.permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions).

## Benchmark GitHub des trackers multi-sites

[Mantium](https://github.com/diogovalentte/mantium) est la référence fonctionnelle la plus proche trouvée : regroupement de plusieurs sources sous une seule œuvre, détection périodique, notifications ntfy et connecteur personnalisé par sélecteurs CSS/XPath. Son code n'est pas adopté comme fondation : il ajoute un backend Go, une interface Python/Streamlit, n'intègre pas d'authentification et ne gère pas durablement les migrations de domaines. FavLib conserve sa stack TypeScript et reprend seulement les patterns suivants :

- une œuvre logique avec plusieurs origines, donc une seule notification par chapitre ;
- un connecteur déclaratif privé configuré par l'administrateur pour les sites simples ;
- sélecteur du numéro et de l'URL, regex optionnelle et aperçu avant activation ;
- erreurs consécutives visibles sans transformer un parseur cassé en « aucune sortie » ;
- version, fixture synthétique, feature flag et retour arrière pour chaque configuration.

Le connecteur déclaratif est une donnée signée/versionnée, jamais du JavaScript distant. Il est limité à un domaine approuvé, aux pages de métadonnées et aux budgets réseau normaux. CSS/XPath ne contourne ni authentification, CAPTCHA, paywall, DRM ou protection anti-bot. Une page authentifiée reste vérifiée par l'extension avec permission explicite.

## Gates avant implémentation réelle

- demander à AniList une autorisation écrite décrivant FavLib, le matching, le cache et la rétention ;
- créer les politiques `AUTHORIZED` de Wikidata et MADB avec attribution, provenance et budget réseau ;
- obtenir de MangaUpdates une confirmation de limite/rétention avant tout job production ;
- ouvrir un compte Brave seulement lorsque la découverte Web entre dans sa wave ;
- ne demander un Client ID MAL qu'après définition des champs réellement nécessaires ;
- auditer chaque premier domaine favori dans une sous-wave Wave 8 ;
- prototyper le connecteur déclaratif sur une fixture synthétique avant tout domaine réel ;
- revérifier versions, engines Node, licences et vulnérabilités avant de générer le lockfile ;
- décider la distribution Chrome avant les tests multi-utilisateurs hors machine de développement.
