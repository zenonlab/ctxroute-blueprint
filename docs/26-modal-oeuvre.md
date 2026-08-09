# Modal œuvre — verso des cartes de bibliothèque

## Objet et périmètre

Cette spécification décrit le nouveau verso de la modal ouverte depuis une
carte de bibliothèque. Elle conserve la mécanique de `PhysicalCard` :
ouverture par clic ou clavier, animation physique, fermeture par Échap, clic
extérieur et contrôle accessible déjà rendu dans le composant. Aucun bouton de
fermeture supplémentaire n'est ajouté à l'en-tête visuel.

Le périmètre initial est la modal. `/library/:mediaId` reste compatible avec
son contrat et pourra réutiliser les mêmes blocs plus tard ; cette page n'est
pas une seconde implémentation de la modal.

Les exemples de ce document utilisent uniquement des identifiants et textes
synthétiques. Aucun titre réel, résultat fournisseur ou donnée utilisateur ne
doit être codé en dur.

## État actuel, construction et suite

| Élément | État au départ | Décision pour cette évolution |
|---|---|---|
| En-tête, couverture, titre, statut, progression | Existant dans la projection bibliothèque et `PhysicalCard` | Réutiliser, sans changer les champs existants |
| Ouverture/fermeture physique et focus initial | Existant | Conserver les comportements et ajouter des tests de régression |
| Verso riche de la modal | À construire | Ajouter les trois onglets décrits ci-dessous |
| Détail `/api/v1/library/:mediaId` | Existant, réponse non encore normalisée pour le verso | Étendre de façon additive avec des blocs versionnés |
| Calendrier et détection de disponibilité | Existant côté API/worker | Le calendrier FavLib reste la source de vérité de la date |
| Autorisation navigateur et livraison push | Partiellement existant selon l'infrastructure | Préparer l'interface ; intégration fonctionnelle ultérieure |
| Autorisation Google | À documenter/intégrer séparément | Identification et consentement uniquement ; aucun événement Google Calendar |
| Découvertes similaires | À construire | Requête bornée, multi-utilisateur et déterministe |
| Suggestions communautaires | Hors périmètre | Ne pas les afficher dans cette version |
| Page `/library/:mediaId` | Compatible | Réutilisation ultérieure des composants et du même contrat |

## Structure fonctionnelle

### En-tête fixe

L'en-tête reste visible au-dessus du contenu défilant et contient :

- couverture ou emplacement de couverture absent ;
- banner lorsqu'il est validé et disponible ;
- titre d'affichage parsé/canonique disponible ;
- type, année et statut lorsqu'ils sont connus ;
- progression personnelle et disponibilité, dans deux libellés distincts.

Les titres longs sont tronqués visuellement avec un titre complet accessible.
Une couverture absente affiche un emplacement neutre, sans URL de remplacement
inventée. Les champs absents sont masqués ; ils ne sont pas remplacés par des
valeurs supposées.

Pour un anime possédant des relations AniList connues, l'en-tête entier est un
contrôle dépliant. Fermé, il conserve la couverture et le titre de la carte et
laisse visibles les trois onglets. Ouvert, il masque les onglets et leur panneau
actif, puis occupe tout l'espace restant de la carte avec la liste bornée des
œuvres reliées : membres de la chronologie prouvée, préquelles, suites,
histoires parallèles, dérivées et autres relations conservées par le catalogue.
Chaque ligne affiche uniquement les champs disponibles — couverture, titre issu
de la politique partagée, format, année et nature de la relation — et peut ouvrir
la page AniList validée dans un nouvel onglet.

Cette liste est la fermeture transitive des relations connues : les relations
d'une œuvre reliée et les membres de sa propre chronologie sont parcourus à leur
tour. Le parcours est déterministe, déduplique chaque état du graphe,
reste borné à huit sauts et à cinquante résultats, et ne déduit jamais une relation
depuis un titre. La couverture d'une ligne est servie par une route privée qui
vérifie à la fois le favori d'origine de l'utilisateur et l'appartenance de la
cible à ce même graphe ; l'œuvre reliée n'a donc pas besoin d'être elle-même un
favori. Les couvertures héritées d'une fusion d'identité restent traçables et sont
acceptées, tandis qu'une couverture réellement absente conserve l'emplacement
neutre.

L'ordre `PREQUEL`/`SEQUEL` établit une position chronologique, pas un numéro de
saison. L'interface emploie donc « Partie chronologique N » tant qu'une preuve
explicite distincte ne permet pas « Saison N ». Ouvrir ou fermer ce panneau ne
change ni l'identité de la carte, ni la progression, ni le favori sélectionné.
La liste provient de la projection bibliothèque déjà reçue ; aucun chargement de
détail ou matching n'est déclenché par son ouverture.

### Onglet « Liens & prochaine sortie »

L'ordre de lecture est le suivant :

1. prochaine sortie du calendrier FavLib ;
2. disponibilité réellement observée ;
3. action de notification ;
4. favoris personnels ;
5. sources de lecture validées.

La sortie est rendue selon son état :

| État | Affichage | Action |
|---|---|---|
| `PLANNED` | « Sortie planifiée », date/precision si connue | Aucune ouverture de chapitre |
| `AVAILABLE` | « Disponible », position et observation | Ouvrir une origine validée |
| `STALE` | « Source obsolète » avec dernière vérification | Pas de promesse de disponibilité |
| `UNKNOWN` | Ligne de date masquée | Afficher l'absence d'information |

La ligne de date est entièrement absente lorsqu'aucune date n'est connue ou
programmée. Une sortie annoncée n'est jamais présentée comme un chapitre
disponible ; la progression personnelle reste indépendante de cette
disponibilité.

L'action de notification indique l'état de l'autorisation navigateur pour
cette œuvre (`NOT_REQUESTED`, `GRANTED`, `DENIED`, `UNSUPPORTED` ou
`SESSION_REQUIRED`). Elle ne crée pas d'événement externe. Le consentement
Google, si demandé, est décrit comme autorisation d'identification/consentement
et ne doit jamais être présenté comme une synchronisation Google Calendar.

Les favoris visibles sont ceux de l'utilisateur connecté uniquement. Ils sont
distincts des sources de lecture validées, qui peuvent être publiques ou
rattachées à un autre périmètre de collecte. Chaque favori affiche son URL
personnelle, son titre parsé et sa progression lorsqu'elle existe; les sources
validées sont rendues dans un bloc séparé, groupées par fournisseur. Chaque
ligne peut afficher le titre parsé, la progression, l'appareil et la provenance
; le titre brut n'est jamais utilisé comme titre visible de remplacement.
Chaque réponse de diagnostic et chaque donnée d'import conservent cependant :

- titre brut et URL brute ;
- résultat du parseur partagé et transformations ;
- `parserId`/version ;
- empreinte et provenance de l'observation.

Les sources sont limitées aux origines validées FavLib. Une ligne expose, si
disponibles, l'état (`AVAILABLE`, `STALE`, `UNAVAILABLE`, `MOVED`), langue, fraîcheur,
attribution et URL canonique. L'action secondaire est libellée par exemple
« Lien mort ? Signalez-le ! » ; elle ouvre un signalement, pas une nouvelle
résolution automatique.

`UNAVAILABLE` correspond à un site inaccessible; `MOVED` correspond à une
réponse HTTP 404. L'absence de favicon reste indépendante de ces états.

Le contrat de détail expose additivement `favorites` et `sources`. Les favoris
contiennent le titre parsé par le parseur partagé, avec le titre/URL bruts,
version du parseur et provenance conservés hors affichage. Les sources validées
portent leur URL canonique, état de santé et provenance. Le signalement
`POST /api/v1/library/:mediaId/source-reports` est dédoublonné par utilisateur,
œuvre et URL; il ne peut ni lire ni écrire les données d’un autre utilisateur.

### Onglet « Description & informations »

Le synopsis est nettoyé avant affichage. S'il est absent, afficher un état
explicite du type « Description indisponible » ; ne pas générer de résumé.

La fiche technique affiche seulement les champs présents : auteur, dessinateur,
studio, statut, format, année et genres/catégories. La provenance fournisseur
et la fraîcheur sont affichées lorsqu'elles sont utiles à l'interprétation.
La fiche ne fusionne pas silencieusement les responsabilités AniList et
MangaUpdates : anime et œuvres de lecture restent rattachés à leur fournisseur
canonique selon la doctrine du dépôt.

### Onglet « Découvertes similaires »

Une candidate est admissible si elle partage des genres/tags fiables et un type
compatible. Sont exclues :

- l'œuvre courante ;
- les membres de sa séquence ;
- toutes les œuvres déjà présentes dans la bibliothèque de l'utilisateur
  connecté.

L'exclusion personnelle doit être faite dans la requête corrélée, et non dans
un filtre d'interface :

```sql
AND NOT EXISTS (
  SELECT 1
  FROM bookmark_media_link personal_link
  JOIN bookmark_import_item personal_item
    ON personal_item.user_id = personal_link.user_id
   AND personal_item.installation_id = personal_link.installation_id
   AND personal_item.bookmark_id = personal_link.bookmark_id
  WHERE personal_link.user_id = $viewer_user_id
    AND personal_link.media_id = candidate.media_id
    AND personal_link.status IN ('matched', 'accepted')
    AND personal_item.event <> 'removed'
)
```

La requête doit également exclure les membres de séquence via les relations
fournisseur prouvées, sans traiter un titre ou une popularité comme preuve
d'identité. Le tri est déterministe : nombre de genres/tags communs, qualité
de la preuve de compatibilité, fraîcheur des métadonnées, puis identifiant
canonique comme départage stable. La popularité ne crée ni identité ni
correspondance.

Le résultat est limité à six œuvres maximum. La grille comporte deux colonnes
sur desktop comme sur mobile. Sans genres/tags fiables, le bloc affiche
« Aucune recommandation fiable » et ne propose pas de candidats arbitraires.

## Contrat de détail

La route reste `GET /api/v1/library/:mediaId`. Les champs actuellement
consommés restent inchangés ; les blocs suivants sont ajoutés dans la réponse.
Les consommateurs doivent ignorer les champs inconnus afin de préserver la
compatibilité avec l'extension et les anciennes versions Web.

```ts
type LibraryDetailV2 = ExistingLibraryDetail & {
  detailVersion: 2;
  nextRelease: {
    state: 'PLANNED' | 'AVAILABLE' | 'STALE' | 'UNKNOWN';
    releaseId: string | null;
    kind: 'episode' | 'chapter' | 'volume' | 'release' | null;
    raw: string | null;
    number: string | null;
    scheduledAt: string | null;
    timePrecision: 'INSTANT' | 'DATE' | 'UNKNOWN';
    observedAt: string | null;
    source: Provenance | null;
  };
  notification: {
    browser: 'NOT_REQUESTED' | 'GRANTED' | 'DENIED' | 'UNSUPPORTED';
    session: 'AUTHORIZED' | 'SESSION_REQUIRED';
    enabledForMedia: boolean;
  };
  personalFavorites: Array<{
    bookmarkId: string;
    device: string | null;
    displayTitle: string | null;
    rawTitle: string;
    parsedTitle: string | null;
    parserId: string;
    parserVersion: string;
    progress: Progress | null;
    provenance: Record<string, unknown>;
    url: string;
  }>;
  validatedSources: Array<{
    state: 'AVAILABLE' | 'STALE' | 'UNAVAILABLE';
    language: string | null;
    freshness: { verifiedAt: string | null; ageSeconds: number | null };
    attribution: Attribution | null;
    canonicalUrl: string;
  }>;
  metadata: {
    synopsis: string | null;
    technical: Record<string, unknown>;
    provider: string | null;
    freshness: string | null;
    provenance: Provenance | null;
  };
  similarDiscoveries: Array<SimilarDiscovery>; // jamais plus de 6
};
```

`ExistingLibraryDetail`, `Progress`, `Attribution` et `Provenance`
désignent les formes partagées déjà présentes dans les contrats ; elles ne
doivent pas être redéfinies dans Web. Les valeurs de `displayTitle`
proviennent du parseur partagé de `packages/metadata`, également utilisé par
l'API, le worker, l'interface de review et l'extension. Une correction locale de
titre est interdite.

Une réponse `401` signifie session non autorisée et une réponse `404` signifie
que l'œuvre n'appartient pas à la bibliothèque de l'appelant. Les erreurs
partielles de calendrier, sources ou découverte ne doivent pas faire disparaître
les blocs déjà valides : elles produisent un état récupérable dans le bloc
concerné et un identifiant de diagnostic côté API.

## Responsabilités par application

| Surface | Responsabilité |
|---|---|
| `packages/contracts` | Types/schémas de détail, enums d'état, OpenAPI, compatibilité additive |
| `apps/api` | Autorisation par `user_id`, projection, provenance, `NOT EXISTS`, borne de six |
| `apps/worker` | Calendrier et disponibilité ; futures préférences de notification ; aucune création Google Calendar |
| `apps/web` | Modal, trois onglets, états UI, focus, grille et titres parsés |
| `apps/extension` | Aucun nouvel écran ; tolérance aux champs inconnus et maintien des contrats d'import existants |

Le contrôle d'autorisation doit être fait dans l'API avant toute projection de
favori, préférence ou recommandation personnelle. Un filtre Web ne constitue
pas une isolation multi-utilisateur.

## États et chargement progressif

Chaque bloc peut être en `loading`, `ready`, `empty` ou
`error_recoverable`. Les états supplémentaires suivants sont visibles
lorsqu'ils sont pertinents :

- sortie annoncée uniquement : `PLANNED`, sans bouton de lecture ;
- source obsolète : `STALE`, avec date de dernière vérification ;
- aucune recommandation : `empty`, sans carte de remplissage fictive ;
- session expirée : `SESSION_REQUIRED`, avec action de reconnexion non
  destructive ;
- erreur API : message local au bloc et bouton de réessai borné.

À l'arrivée progressive des données, les skeletons sont remplacés bloc par
bloc. L'en-tête ne saute pas de hauteur ; une section absente est masquée après
chargement plutôt que remplacée par une valeur artificielle. Le défilement est
interne à la modal et le document derrière reste verrouillé.

## Règles visuelles et accessibilité

### Desktop et mobile

```text
┌ couverture/banner + titre + état fixe ┐
├ Liens & sortie │ Description │ Similaires ┤
│ contenu de l'onglet, défilement interne │
└ contrôle Fermer accessible, attaché à la carte ┘
```

Sur desktop, la modal conserve le ratio vertical de `PhysicalCard`, avec une
largeur bornée par la fenêtre et des marges de sécurité. Sur mobile, elle ne
dépasse jamais la fenêtre disponible ; l'en-tête reste fixe, le contenu défile,
et les découvertes restent sur deux colonnes avec cartes compactes. Les
longues descriptions utilisent une hauteur maximale et un défilement local.

Les onglets sont un vrai pattern `tablist`/`tab`/`tabpanel`, avec sélection
clavier par Tab puis flèches gauche/droite, et activation cohérente avec les
autres contrôles. Le focus est placé sur le contrôle de fermeture à l'ouverture,
reste dans la modal et revient au déclencheur à la fermeture. Le lecteur d'écran
reçoit le titre de la dialog, l'onglet sélectionné et les états de source/sortie.

Le contraste respecte les tokens CSS FavLib pour texte, surface, bordure et
état. Les états ne reposent jamais sur la couleur seule : texte et/ou icône
accompagnent `Planifiée`, `Disponible`, `Obsolète` et `Indisponible`. Avec
`prefers-reduced-motion: reduce`, l'ouverture et la fermeture vont directement
à l'état final, sans perdre le focus ni le contenu.

## Tests d'acceptation

Les fixtures et titres de test sont synthétiques.

### Web et modal

- ouverture par clic, Entrée et Espace ; fermeture par Échap, clic extérieur et
  bouton accessible ; restitution du focus ;
- navigation clavier entre les trois onglets et annonce correcte au lecteur
  d'écran ;
- ouverture du panneau des œuvres reliées depuis tout l'en-tête, mise à jour de
  `aria-expanded`, masquage temporaire des onglets et restitution de ceux-ci à
  la fermeture ;
- chronologie complète et relations hors chronologie affichées sans transformer
  `memberOrder + 1` en numéro de saison ;
- date masquée lorsque `scheduledAt` est nul et état `UNKNOWN` ;
- distinction visuelle et sémantique entre `PLANNED` et `AVAILABLE` ;
- titre parsé affiché, titre brut conservé dans le payload de diagnostic ;
- synopsis long, couverture absente, titre long et données arrivant par blocs ;
- sources `AVAILABLE`, `STALE` et `UNAVAILABLE` avec attribution et lien
  canonique ;
- réponse vide, erreur récupérable, session expirée et réduction des animations.

### API, données et isolation

- Alice ne reçoit aucun favori, préférence ou recommandation personnelle de Bob ;
- œuvre courante, membres de séquence et œuvres déjà présentes sont exclus ;
- la requête utilise une exclusion corrélée `NOT EXISTS` avec le propriétaire ;
- le résultat ne contient jamais plus de six recommandations ;
- genres/tags absents ou non fiables donnent zéro recommandation ;
- le tri est stable et ne dépend pas de la popularité ;
- la route conserve tous les champs de détail existants et ignore les blocs
  optionnels indisponibles.

### Contrats transversaux et worker

- `packages/contracts` valide le payload nominal, vide, partiel et erreur ;
- `apps/api` sérialise la même version et applique l'autorisation ;
- `apps/worker` distingue annonce calendrier, disponibilité et notification
  future ; aucun événement Google Calendar n'est créé ;
- `apps/web` consomme les états sans titre brut de repli ni parser local ;
- `apps/extension` accepte la réponse enrichie sans modifier son interface ni
  casser l'import, la progression ou la provenance.

### Régressions parser/résolveur

Ajouter des cas synthétiques dans `packages/metadata` et les suites worker :

- AniList et MangaUpdates appliquent exactement la même séquence : titre exact
  ordonné, mots significatifs réordonnés, puis distance d'édition bornée ;
- une égalité de niveau ouvre une review et la popularité ne départage jamais ;
- un anime ne rapproche une saison qu'avec une preuve explicite concordante ;
- un numéro final nu conserve sa provenance et ne réécrit pas l'identité ;
- titre brut, transformations, version du parseur et provenance sont conservés ;
- aucun titre réel, correction de domaine ou résultat de fournisseur n'est
  introduit dans le résolveur.

## Livraison et limites

La livraison doit inclure, dans la même évolution, les schémas/contrats, les
tests API/worker/Web/extension et cette documentation. Une compilation seule
ne valide ni l'isolation multi-utilisateur ni la provenance.

Les notifications navigateur et l'autorisation Google sont une évolution
ultérieure : le calendrier FavLib reste l'unique source de vérité de la date,
le navigateur assure la livraison et Google ne fournit que l'identification ou
le consentement autorisé. Aucun événement, abonnement ou écriture Google
Calendar ne fait partie de cette modal.
