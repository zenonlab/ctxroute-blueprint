# Carte des surfaces UI

Cette carte fixe le rôle de chaque surface avant la création des composants.
Une information possède une surface principale ; les autres surfaces ne montrent
qu'un résumé ou un raccourci vers celle-ci.

## Surfaces produit

| Surface | Rôle principal | Contenu essentiel | Ne doit pas devenir |
| --- | --- | --- | --- |
| Menu d’extension | Agir sans quitter la page active | œuvre détectée, reprises récentes, prochaines sorties et réglages rapides | un tableau de bord, une bibliothèque miniature ou la page complète de réglages |
| Bibliothèque | Parcourir et maintenir les œuvres suivies | filtres puis cartes directement, ou un état central illustré si aucun contenu n'est utilisable | un miroir de favoris navigateur ou un second titre sous la navigation |
| Panneau Review | Résoudre les correspondances ambiguës depuis le header | contexte condensé, candidats, preuve de source, saisie manuelle AniList/MangaUpdates, absence de correspondance, conflit de révision | une page autonome, une carte mère ou un avis utilisateur |
| Agenda | Comprendre les prochaines sorties | semaine de sept jours, lecture horizontale, dates officielles, confirmées ou estimées | une liste verticale infinie ou une date présentée comme certaine sans provenance |
| Réglages complets de l’extension | Organiser les favoris depuis l’extension | arbre de dossiers ordonné, filtres réellement disponibles et aperçu local des déplacements | une page générale de préférences, de diagnostic ou d’export |

Les pages complètes Bibliothèque et Agenda partagent une shell membre
unique. Il reprend le logo, les trois destinations principales de
FavLib, la recherche globale et une cloche « Correspondances à vérifier ». Son
badge disparaît à zéro. La cloche ouvre une bulle non modale ancrée sous le
déclencheur, sans rendre le fond inerte. Escape et le clic extérieur la ferment
et restituent le focus à la cloche. Ce panneau est l'unique surface
Review visible et compose le `ReviewResolver`, alimenté uniquement par des
données sérialisables et des callbacks. Le favori à résoudre reste un contexte
compact ; seules les candidates utilisent la coque `WorkCard`. Le menu de
l’extension reprend la coque FavLib en trois zones fixes : marque en tête,
panneau actif, puis navigation compacte Page, Sorties et Réglages. Le premier
panneau nomme l’élément détecté « Cette œuvre » : sa `WorkCard` paysage 3:2
ouvre la dernière URL utile observée. « Continuer mes œuvres » vient dessous,
dans le même viewport verticalement défilable, avec au plus cinq `WorkCard`
portrait 2:3 représentant des œuvres interrompues et non terminées. Sorties
reste un onglet distinct. Page et Sorties réutilisent `WorkCard`; l’onglet
Sorties lit la même période Agenda locale que la page complète et ne rend rien
lorsque cette période est vide. Une sortie ouvre sa source favorite locale ;
sans source, la même `WorkCard` reste visible mais non interactive et annonce
son indisponibilité. Réglages contient seulement les
préférences quotidiennes et un accès à l’organisateur complet. La surface reçoit
ses modèles sérialisables séparément de ses callbacks, sans lire le navigateur,
IndexedDB ou le réseau. Tant que les ports de lecture ne sont pas raccordés,
le runtime affiche une indisponibilité explicite au lieu d’un chargement ou
d’un contenu inventé. Le cache de reprise local est borné à cinq entrées et
trente jours, n’est ni exporté ni autoritaire et peut disparaître avec les
données de l’extension. Les Réglages complets reprennent l’organisateur FavLib en page entière,
sans recherche globale ni navigation du site. La première vue édite l’arbre de
dossiers et ses filtres dans l’ordre de priorité ; la seconde devient une page
d’aperçu complète, sans coque de dialogue. L’application et la restauration
restent absentes tant que leurs callbacks navigateur et snapshot n’existent pas. Les préférences
rapides restent dans le popup.
L’arbre est récursif : un dossier peut créer ses propres enfants. Le rang est
affiché en contraste au centre du pictogramme de dossier rempli et correspond
uniquement à sa place parmi ses frères. Le bouton Filtres développe sous le dossier
les groupes réellement fournis par l’hôte. Le runtime actuel propose Manga et
Anime ; les statuts éditoriaux et la progression restent absents faute de données locales fiables.
Renommer, filtrer, créer, supprimer ou réordonner invalide immédiatement l’aperçu.
Chaque règle, aperçu et action provient de l’hôte sous forme sérialisable ou de
callback ; la surface ne lit aucune API navigateur, aucun stockage et aucun réseau.
L’Agenda reçoit sept jours sérialisables et les callbacks de navigation de
semaine. Ces colonnes restent disposées de gauche à droite sur écran étroit et
le rail devient horizontalement défilable au lieu d’allonger la page.

Les surfaces de marque utilisent le même logo PNG officiel issu de FavLib via
le composant public `TobirinkLogo`. Les pictogrammes fonctionnels restent fournis
par `Icon` et Lucide ; ils ne remplacent jamais la marque.
La cloche reste visuellement identifiable au repos, immédiatement à droite de
la recherche. Le pied du resolver affiche précédent, position courante et
suivant ; avancer reporte temporairement l'élément sans enregistrer de décision.
La file locale alimente ce compteur et cette navigation sur Bibliothèque,
Agenda et la route Review. Si aucun candidat n'est encore disponible, le
contexte du favori et les flèches restent visibles mais aucune saisie ni action
de décision factice n'est proposée.
La recherche du header ouvre la Bibliothèque sur un résultat local borné et
accent-insensible. Elle interroge IndexedDB via le worker, ne filtre pas
seulement la première page visible et ne contacte aucun fournisseur distant.
Review propose uniquement les œuvres locales qui possèdent déjà une source
HTTP(S) résolue. Une saisie manuelle vérifie de la même manière un identifiant
ou une URL locale unique avant d'écrire ; elle ne déclenche aucun appel D1.
Quand la file est vide, la bulle reprend l'empty state FavLib compact : une
icône Inbox grise et le seul libellé « Aucune correspondance à vérifier », sans
en-tête ni description internes supplémentaires.
La route Bibliothèque commence directement par ses filtres et ses cartes, sans
en-tête local redondant. Ses états non utilisables, comme ceux de la route
Review, réutilisent `FeedbackState` en présentation centrée avec une icône
Lucide grise, un texte court et aucune coque visuelle. L'état vide de la
Bibliothèque propose de télécharger l'extension via un callback fourni par son
hôte, sans destination codée en dur. La route Review explique seulement que la
résolution se trouve dans la cloche ; elle ne duplique ni la file ni ses choix.

## Parcours reliés aux surfaces

| Parcours | Entrée | Surface de travail | Résultat visible |
| --- | --- | --- | --- |
| Organisation des favoris | Réglages complets | Arbre puis aperçu | règles enregistrées localement et déplacements explicitement prévisualisés |
| Résolution | Cloche du header | Panneau Review | décision atomique locale puis candidat suivant |
| Recherche globale | Recherche du header | Bibliothèque filtrée par la requête locale | jusqu’à 24 œuvres locales, sans réseau |
| Observation de progression | Ouverture du popup sur une page compatible | titre et URL `activeTab` corrélés à une œuvre locale unique | hausse enregistrée automatiquement dans IndexedDB et affichée par WorkCard ; valeur égale inchangée, baisse ignorée |
| Consultation d'une sortie | Bibliothèque ou onglet Sorties du menu d’extension | Agenda | date qualifiée par son niveau de confiance |
| Configuration d'un rappel | Agenda | Agenda puis Réglages si permission absente | rappel local confirmé ou raison du blocage |

## Workbench local

Le workbench est un outil de développement indépendant des surfaces produit.
Il n'est ni une route de l'extension ni une dépendance de son bundle de
production.

Son interface de bureau comporte deux zones :

1. À gauche, un catalogue filtrable découvre automatiquement les fichiers
   `*.preview.tsx` placés à côté des composants.
2. Au centre, un canevas rend les variantes, états et largeurs Auto, 390 ou
   768. Une preview indique si elle représente un composant isolé, une page
   complète ou une popup : la page utilise toute la largeur, la popup conserve
   son format borné et le composant garde le cadre d'inspection.

Le Workbench n'embarque ni éditeur de code ni sources brutes. Le navigateur ne
reçoit aucun accès au système de fichiers.

Chaque fiche expose aussi son rôle, ses propriétés publiques, ses dépendances,
ses règles d'accessibilité et un exemple d'usage. Les éléments prévus mais pas
encore implémentés restent visibles avec l'état `Planifié` ; une preview réelle
remplace cet état dès qu'elle est découverte.

La sélection est synchronisée avec le fragment d'URL (`#work-card`,
`#agenda`, etc.) afin qu'un lien ouvre directement la bonne fiche. Un fragment
inconnu revient au premier élément sans produire d'erreur.

Sur une largeur réduite, le catalogue et le canevas deviennent deux onglets.
Cette adaptation sert à inspecter le workbench ; elle ne crée pas une
nouvelle surface produit.
