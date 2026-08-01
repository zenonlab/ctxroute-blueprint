# Favoris, AniList et connecteurs

## Ce que signifie « tous les favoris »

Chaque favori possédant une URL est examiné localement. Aucun dossier spécial n'est requis. Un dossier Chrome peut devenir une catégorie seulement avec consentement ; son chemin complet n'est jamais envoyé par défaut.

Le traitement se fait en deux temps :

1. l'extension examine l'inventaire complet et élimine localement les non-médias évidents ;
2. l'API locale classe uniquement les candidats médias et purge sous 24 heures ceux qu'elle ignore.

Lors des réconciliations suivantes, les fingerprints keyed locaux sont comparés avant tout envoi. Une nouvelle version du classifieur local invalide volontairement les décisions précédentes.

L'extension utilise [`chrome.bookmarks`](https://developer.chrome.com/docs/extensions/reference/api/bookmarks). La permission affiche « lire et modifier vos favoris », mais FavLib reste techniquement en lecture seule : aucune fonction `create`, `update`, `move`, `remove` ou `removeTree` n'est appelée.

## Pipeline de tri

```text
favori brut dans l'extension
  → validation du schéma URL
  → normalisation domaine/URL
  → préfiltre local domaine + chemin + signaux média
  → non-média : décision locale, aucun envoi
  → candidat média : API locale
  → classification page œuvre/chapitre/épisode/autre
  → extraction d'un titre candidat et d'une position éventuelle
  → inspection par le connecteur du site
  → recherche AniList ANIME ou MANGA
  → score de correspondance
  → reconnu / à vérifier / ignoré
```

### Signaux de matching

- titre principal et titres alternatifs ;
- titre nettoyé du favori et de la page ;
- domaine et type de page ;
- anime contre manga/manhwa/manhua ;
- format, année, saison et statut ;
- numéro d'épisode/chapitre plausible ;
- URL canonique déjà liée par un autre favori du même utilisateur ;
- catégorie Chrome transmise uniquement avec consentement comme indice de faible poids.

Le score et ses raisons sont conservés avec la version du classifieur pour rendre chaque décision reproductible.

### Seuils initiaux à calibrer

- score élevé : liaison automatique ;
- score intermédiaire : file « À vérifier » ;
- score faible ou contenu manifestement non média : ignoré et purgé.

Les seuils numériques seront déterminés sur un jeu de favoris anonymisé, pas choisis arbitrairement dans le code.

## AniList

L'[API GraphQL AniList](https://docs.anilist.co/guide/introduction) enrichit les œuvres reconnues : titres, affiche, type, format, statut, saison et calendrier disponible. Elle sert également au matching, mais n'est pas une source universelle pour savoir sur quel site une œuvre est disponible.

Le service Metadata AniList doit :

- mettre les résultats en cache ;
- regrouper les requêtes ;
- respecter les en-têtes et limitations officielles ;
- appliquer un backoff sur `429` ;
- fonctionner en mode dégradé lorsque l'API est indisponible ;
- ne jamais bloquer l'import complet des favoris.

Une œuvre absente d'AniList peut être créée depuis les données fiables du connecteur du site, avec le statut `unmatched`.

## Cache

FavLib met en cache les recherches/métadonnées AniList, inspections d'URL, snapshots de disponibilité et échecs négatifs courts dans PostgreSQL. L'extension conserve seulement fingerprints et événements minimaux ; TanStack Query conserve les vues Web personnelles.

Les caches sont contextualisés, expirables et invalidés par changement de favori, connecteur, locale, région ou canonicalisation. Le dernier snapshot valide reste visible avec son âge pendant une revalidation. Aucun HTML durable, image de chapitre, vidéo ou autre média tiers n'est mis en cache. Voir [ADR 0008](adr/0008-cache.md).

## Types de pages

Chaque connecteur doit reconnaître explicitement :

- `work` : fiche générale de l'œuvre ;
- `chapter` : chapitre précis ;
- `episode` : épisode précis ;
- `listing` : liste de sorties, non assimilée automatiquement à une œuvre ;
- `other` : page non exploitable.

Pour une page précise, le connecteur retourne à la fois l'œuvre parente, sa cible canonique de surveillance et la position éventuellement extraite.

## Contrat d'un connecteur

```ts
type PageKind = "work" | "chapter" | "episode" | "listing" | "other";
type Evidence = "api" | "feed" | "structured-data" | "dom" | "bookmark";

interface SourceConnector {
  id: string;
  domains: string[];
  version: string;
  canHandle(url: URL): boolean;
  classifyUrl(url: URL): PageKind | "unknown";
  inspect(input: InspectInput): Promise<SourceInspection>;
  check(input: CheckInput): Promise<CheckResult>;
}

interface SourceInspection {
  pageKind: PageKind;
  canonicalWorkUrl?: string;
  canonicalCheckUrl?: string;
  sourceTitle?: string;
  mediaHint?: "ANIME" | "MANGA";
  position?: {
    raw: string;
    normalized?: string;
    confidence: number;
  };
  evidence: Evidence[];
}

interface CheckResult {
  canonicalCheckUrl: string;
  sourceTitle: string;
  releases: Array<{
    sourceKey: string;
    kind: "chapter" | "episode";
    label: string;
    numberRaw?: string;
    numberNormalized?: string;
    publishedAt?: string;
    url: string;
  }>;
  evidence: Evidence[];
  checkedAt: string;
}
```

Le connecteur décrit le site. Le cœur métier décide du matching, de la progression, de la déduplication et des notifications.

## Plusieurs sites et origines

Plusieurs favoris ou catalogues autorisés peuvent rattacher des pages différentes au même `media`. Les sorties équivalentes sont regroupées en `release` logique, avec une `release_origin` par site, langue, édition ou groupe.

Le résolveur préfère la source épinglée, la prochaine sortie sans rupture, la langue/région choisie, une origine officielle lorsque ce statut est vérifié, puis la santé et la fraîcheur. Si la source préférée est indisponible, il propose ou utilise un fallback selon la préférence de l'utilisateur. Il n'altère ni progression, ni favori, ni préférence permanente. Voir [ADR 0009](adr/0009-resolution-multi-source.md).

Une alternative provient seulement d'un autre favori personnel, d'une cible publique redécouvrable ou d'un catalogue/API autorisé. Une API Comick non documentée n'est pas une dépendance acceptable ; Comick devra suivre la procédure normale d'une sous-wave Wave 8.

Une alternative enrichit uniquement une œuvre déjà présente grâce aux favoris de cet utilisateur. Elle ne devient jamais automatiquement une entrée de bibliothèque, un abonnement ou un favori.

## Ordre des méthodes de collecte

1. API officielle ;
2. webhook ou RSS/Atom ;
3. JSON-LD ou JSON embarqué ;
4. HTML statique ;
5. extraction locale par l'extension sur une page autorisée ;
6. navigateur headless uniquement si le site l'autorise et si la valeur est démontrée.

Un moteur de recherche n'est pas interrogé à chaque cycle. L'URL à vérifier provient du favori et de sa canonicalisation.

Un favori Chrome ne change pas automatiquement lorsqu'un site publie. Il indique à FavLib quelle œuvre et quelle page canonique doivent être surveillées. C'est ensuite le connecteur qui constate la nouvelle sortie.

## Extension sur le site

Un content script n'est activé que sur un domaine approuvé. La popup peut afficher :

- le type de page active ;
- l'œuvre FavLib associée ;
- le favori logique correspondant ;
- la position extraite ;
- la dernière sortie disponible ;
- l'écart entre progression et disponibilité ;
- un lien vers `/library/:mediaId`.

Si la page n'est pas favorite et ne correspond pas à l'œuvre parente d'un favori existant, l'extension ne l'ajoute pas à FavLib et ne produit aucune progression.

Les requêtes vers le serveur FavLib local partent du service worker de l'extension avec une permission d'hôte limitée à l'origine configurée. Les content scripts n'obtiennent jamais un proxy réseau arbitraire.

## Détection de progression par favori

La décision complète est définie par [ADR 0001](adr/0001-progression-contextuelle.md).

### Favori modifié

```text
/serie/episode-11 → /serie/episode-12
  → même œuvre et même source
  → position 12 avec confiance forte
  → progression observée avance à 12
```

### Plusieurs favoris de chapitres

Les URLs sont rattachées à la même œuvre et ne créent pas plusieurs cartes. La progression consolide la position fiable la plus avancée uniquement dans une même séquence ordonnée ; saisons et spéciaux restent des curseurs distincts.

### Favori de fiche générale

Il crée l'abonnement et permet la surveillance. La progression reste `unknown` jusqu'à l'apparition d'un signal précis.

### Navigation contextuelle consentie

Une page précise ouverte peut avancer une progression `observed` si le connecteur rattache avec forte confiance cette page à une œuvre déjà favorite. Cette observation n'affirme pas que l'épisode a été terminé et ne collecte aucun historique hors de ce périmètre.

## Surveillance des sorties

- cible publique vérifiée toutes les 6 à 12 heures avec jitter ;
- priorité adaptée aux horaires de diffusion AniList lorsqu'ils existent ;
- cible terminée ou inactive vérifiée moins souvent ;
- requêtes conditionnelles avec `ETag` et `Last-Modified` ;
- verrou et budget réseau par domaine ;
- pause après erreurs répétées ;
- résultat vide ou fortement décroissant mis en quarantaine ;
- hash et champs extraits conservés, pas une copie permanente de tout le HTML.

## Ajouter un nouveau site

Chaque site réel constitue une wave séparée :

1. vérifier API, RSS, conditions et robots ;
2. collecter des fixtures autorisées pour fiche, chapitre/épisode et erreur ;
3. documenter les formes d'URL ;
4. implémenter classification, inspection et vérification ;
5. tester canonicalisation et positions spéciales ;
6. tester HTML vide et changement de structure ;
7. activer derrière un feature flag ;
8. faire valider la sortie avant le site suivant.

FavLib ne contourne ni authentification, ni paywall, ni CAPTCHA, ni DRM et ne republie pas le contenu.
