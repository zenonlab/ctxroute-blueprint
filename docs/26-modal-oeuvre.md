# Modal œuvre — navigation root-scopée

## Principe

La modal ouverte depuis une carte de bibliothèque conserve cette carte comme
racine d’autorisation pendant toute sa session. Son en-tête affiche la
couverture, le titre actif, le type en grand et un chevron. Lorsqu’une
chronologie prouvée existe, l’en-tête ouvre juste en dessous un sélecteur
vertical compact et défilant, sans encadrement.

Il n’existe ni bouton textuel « Fermer », ni croix, ni historique interne.
Échap et un clic ou tap sur le backdrop ferment la modal, restaurent le focus
sur la carte d’origine et réinitialisent l’œuvre active. Une réouverture repart
donc toujours de la projection de bibliothèque initiale.

## Même œuvre et découvertes

Le sélecteur « même œuvre » contient exclusivement l’œuvre active et les
membres dont l’appartenance est prouvée par `anime_work_member` et matérialisée
par `sequenceOrder`. Un titre ressemblant, un nombre final ou la popularité ne
peut jamais y ajouter une œuvre. Toutes les parties prouvées sont affichées,
sans limite d’interface arbitraire.

Les autres nœuds atteignables du graphe — spin-offs, side stories, adaptations,
pré/suites non membres et autres relations — apparaissent uniquement dans
« Découvertes ». Un identifiant déjà présent dans le sélecteur en est exclu.
L’API conserve une fermeture bornée à 50 œuvres ; l’interface limite
« Découvertes » aux 24 premières relations déterministes.

Le sélecteur affiche une ligne par partie avec miniature, type et titre dans le
même langage visuel que l’en-tête. L’œuvre active y est indiquée sobrement et
sa ligne est inactive. « Découvertes » utilise une grille fixe de deux colonnes
sur ordinateur et mobile. Ses cartes reprennent exactement celles de la
bibliothèque : couverture 2:3, overlays de statut et de progression
personnelle/disponible, titre et type. Une valeur absente reste affichée comme
absente et n’est jamais héritée de la racine.

## Navigation dans la modal

Sélectionner une partie ou une découverte appelle uniquement :

```text
GET /api/v1/library/:rootMediaId/related/:mediaId
```

Pendant le chargement, le contenu courant reste affiché avec `aria-busy`. Une
erreur est locale et ne remplace aucune donnée. Les détails réussis sont mis en
cache jusqu’à la fermeture de la modal.

Après succès, couverture, titre, type, synopsis, métadonnées, favoris, pages
fournisseur, sources et relations sont remplacés ensemble. Le sélecteur se
ferme, l’onglet « Liens » redevient actif et un live region annonce le nouveau
titre. Il n’y a aucune navigation de page et aucune pile retour.

## Onglets et contenus

Les onglets sont des contrôles textuels sans boîte, icône ni description :

- « Liens » ;
- « Informations » ;
- « Découvertes ».

Un soulignement orange identifie l’onglet actif. Les lignes
fournisseur, favoris et sources n’ont ni fond ni bordure. Copier et signaler
restent des boutons tactiles sans bordure, avec un focus visible. Les états
vides, notices et métadonnées restent eux aussi sans cadres décoratifs.

## Face de signalement

« Signaler un problème » déclenche une seconde rotation physique de 180° depuis les détails. Cette face est strictement textuelle et n’affiche aucune couverture, bannière ou image source. Retour et Échap inversent seulement cette seconde rotation et restaurent le focus sur le bouton de signalement ; un second Échap depuis les détails ferme la modale. Avec réduction des animations, le changement de face est immédiat.

Le parcours distingue l’identité de l’œuvre et l’association à un site vérifié, impose des raisons structurées et une confirmation avant envoi, puis affiche les états envoi, succès, erreur récupérable, session expirée, attente admin et liste vide. Une indisponibilité ou redirection reste un contrôle de santé automatique. Un signalement ne change jamais la carte ni les recommandations : seul un jugement administrateur audité et réversible possède cette autorité.

Les titres affichés viennent de la sélection de titre partagée. Les favoris
conservent titre/URL bruts, résultat du parseur, version et provenance dans le
payload ; le brut ne remplace pas silencieusement le titre parsé. La progression
personnelle, les favoris et les sources sont recalculés pour l’œuvre active et
ne sont jamais hérités de la carte racine.

## Autorisation et couvertures

La route de détail répond 404 si la racine n’appartient pas à l’utilisateur ou
si la cible n’est pas dans les 50 nœuds autorisés de la fermeture transitive.
La même réponse évite de révéler lequel des deux contrôles a échoué. Les statuts
de lien admis restent `matched`, `accepted` et `review`, afin de préserver les
sémantiques de review existantes.

Chaque couverture reliée utilise une URL privée root-scopée :

```text
/api/v1/library/:rootMediaId/related/:mediaId/cover
```

Cette route applique exactement la même vérification d’appartenance et de
graphe borné. Une couverture issue d’une fusion d’identité reste acceptée avec
sa provenance ; une couverture absente reste absente.

## Compatibilité et vérification

Le payload est additif et tolère les champs inconnus. Chaque relation peut
inclure le statut public, la disponibilité et la progression strictement
scopée à l’utilisateur courant. L’extension et le worker ne consomment pas la
nouvelle route : leurs contrats d’ingestion, progression, parser partagé et
review ne changent pas. Toute évolution ultérieure doit être
vérifiée conjointement dans `apps/extension`, `apps/api`, `apps/worker`,
`apps/web` et `packages/contracts`.

Les régressions synthétiques couvrent cinq parties visibles, la séparation des
découvertes, la limite de 24, le remplacement complet, le cache de session,
l’échec réseau/404, la réinitialisation à la fermeture, le focus, le backdrop,
Échap, mobile, desktop et la réduction des animations.
