---
scope:
  - docs/systems/favorite-parsing-resolution-spec.md
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
  - packages/domain/**
  - packages/application/**
  - packages/contracts/**
  - packages/adapters-browser/**
  - packages/adapters-indexeddb/**
  - apps/extension/**
  - scripts/parser-equivalence/**
review: on-change
revised: true
---

# ADR-0037 — Contrat versionné de résolution des favoris

- Status: accepted
- Date: 2026-09-07
- Revised: 2026-09-14

## Contexte

La pipeline précédente créait une Review à l'import et pouvait confier à
Kitsu une recherche principale indisponible. La reconstruction clean-room doit
fixer les comportements utiles sans reprendre le runtime ou les données FavLib.
La doctrine historique `3267de2` est une source de décisions
revues, précisée puis remplacée par le contrat TobiRink du 2026-09-08.

## Décision

La version `source-adapter-v3` réanalyse aussi les routes de sortie racine
bornées, sans supposer manga lorsque la catégorie manque. Ces adaptateurs de
source sont des parseurs locaux et n'effectuent aucun fetch. Les checkpoints
fournisseur, la recherche et l'hydratation des cinq fournisseurs appartiennent
au collecteur Public Discovery portable exécuté par le consumer Queue du
Worker. Les
références croisées modernes MangaDex→MangaUpdates sont converties depuis le
slug base36; un ancien identifiant décimal `series.html` ne devient jamais un
ID API.

Le [plan de correction v3](../systems/favorite-resolution-correction-plan.md)
possède la pipeline, les 30 écarts, migrations et critères d'équivalence.
La [spécification](../systems/favorite-parsing-resolution-spec.md) conserve les
règles pures et la [pipeline](../systems/favorite-resolution-rebuild-pipeline.md)
leur orchestration. Les prescriptions v1/v2 contraires sont remplacées.

Autorités selon ADR-0025 : favoris pour présence/progression observée;
IndexedDB pour les transactions privées; sync pour IDs publics seuls.
Import atomique source/artefact/tâche, aucune Review créée. Source→Work direct,
Review optionnelle. Résultats stricts : RESOLVED, REVIEW_REQUIRED avec
AMBIGUOUS ou NOT_FOUND, UNSUPPORTED, RETRYABLE. Seul l'humain confirme no-match.
La cloche affiche uniquement les ambiguïtés et introuvables actionnables.
Le choix humain accepte une identité du jeu effectivement comparé, même sans
fiche préalable en bibliothèque. Le commit relit la révision, crée la fiche et
ses aliases explicitement confirmés, et lie la source atomiquement. Un résultat
NOT_FOUND terminé garde la saisie manuelle et la confirmation no-match actives.

Ordre dans l'extension : ID/URL exact, règle origine/route, artefact/aliases,
fiche locale hydratée, snapshot privé synchronisé, puis D1 public `VERIFIED` ou
Review terminale. Un `MISS` produit une demande v3; le consumer Queue route
ensuite AniList anime puis Kitsu Anime après NO_MATCH complet, et
MangaUpdates manga/manhwa/manhua puis MangaDex et Kitsu Manga. Une référence
AniList manga explicite reste hydratable par le collecteur.
Type inconnu : lanes indépendantes, aucune validation unilatérale si l'autre
lane manque; deux identités de types différents imposent Review.

Panne, 403, 429, timeout et réponse incomplète n'autorisent pas le fallback.
Un 403 ne prouve ni un arrêt documenté du fournisseur ni un NO_MATCH.
Le transport fournisseur n'existe pas dans le navigateur. La compatibilité
MangaUpdates est confinée au collecteur serveur, qui n'a pas besoin d'une règle
déclarative MV3 pour modifier l'en-tête Origin.
La version 2 des règles embarquées reconnaît les routes Comix `/title/`
avec un préfixe opaque de cinq caractères et le segment optionnel
`identifiant-chapter-numéro`. Ces deux formats sont des options fermées du
parseur de règles, jamais des expressions régulières exécutables à distance.
L'URL canonique conserve l'identifiant; le titre recherché l'exclut. Le type
MANGA évite une recherche anime injustifiée. Les règles locales validées les
plus récentes priment sur un cache propriétaire plus ancien. L'import existant
réenfile les artefacts dont le fingerprint change sans effacer leurs sources.
Kitsu n'arbitre pas l'ambiguïté principale. Le matcher s'arrête au premier
niveau probant : ID, URL, titre exact, saison corroborée, tokens réordonnés,
distance bornée. Plusieurs identités distinctes sont ambiguës. Popularité,
rang, ordre, couverture et premier résultat sont interdits comme preuves.
OVA/pré-sérialisation restent des compatibilités symétriques; taxonomie
éditoriale s'applique après hydratation, sans fabriquer une identité.

La préparation structurée v2 conserve le titre brut avant toute variante. Un
suffixe parenthésé final, non vide et non imbriqué, peut exposer sa base et son
contenu comme aliases avec provenance. Une année, un nombre seul, une langue,
un format ou un marqueur de pré-sérialisation reste un qualificatif, jamais un
alias d'identité. Face à une source non parenthésée, le titre exact et toutes
les identités fournisseur dont la seule différence est ce suffixe appartiennent
au même groupe exact : une identité reste résoluble, plusieurs imposent Review.
Une source qui porte le suffixe complet conserve d'abord sa comparaison exacte.
Les préfixes substantiels avant virgule ou point-virgule et les formes
normalisées/compactes servent uniquement à la découverte fournisseur; le
matcher ne les reçoit pas comme preuve.

Le runner transmet systématiquement la présence ou l'absence des marqueurs OVA
et pré-sérialisation au filtre symétrique. Les versions parser/matcher/fenêtre
changent ensemble afin de réenfiler les seules décisions automatiques. Lors de
ce reparsing, une ancienne appartenance de bibliothèque sans autre
`FavoriteSource` observée et résolue est retirée de la projection dérivée.
La `Work`, sa progression, les reçus et toute décision humaine sont conservés.

Payload valide, pagination du catalogue et fenêtre de recherche sont distincts.
Un endpoint de découverte classé par pertinence n'est jamais parcouru comme un
export de catalogue : la résolution inspecte au plus une page de 20 à 25
résultats pour chacun des quatre premiers aliases distincts. Le matcher compare
toutes les identités du meilleur niveau dans cette fenêtre; l'ordre du
fournisseur ne constitue toujours aucune preuve. Une identité exacte ou une
saison corroborée unique termine immédiatement la recherche. Un résultat faible
continue sur les aliases bornés. Le fallback reçoit `NO_MATCH` seulement après
l'épuisement de cette fenêtre; une erreur de transport reste `RETRYABLE`.

Le collecteur v3 utilise des checkpoints par fournisseur liés au digest de la
demande et au claim courant. Il retient au plus 20 identités au meilleur niveau
de preuve et avance de façon bornée sur les aliases. `Retry-After` reporte la
reprise serveur sans ouvrir de permission fournisseur dans MV3.
Les aliases mémorisés dans Work doivent eux-mêmes correspondre à la fiche
hydratée; un libellé libre du favori ne devient pas un alias par simple voisinage.
Une indisponibilité D1 n'annule jamais une correspondance locale déjà prouvée.
Le port public strict reçoit seulement une clé SHA-256 versionnée et une requête
bornée. Une saisie manuelle utilise une clé dédiée incluant le fournisseur et
l'identifiant afin de ne pas entrer en conflit avec la requête par titre.
`PENDING` reporte sans fournisseur dans l'extension; `VERIFIED` contient le
profil exact hydraté. Seul le consumer Queue natif peut réclamer puis publier
conformément à ADR-0046.

Parser, matcher, progression, normalisation, règles, décisions et reçus sont
versionnés. Brut et transformations restent locaux. Les règles distribuées
par Worker sont des données JSON bornées origine/segments/type/progression;
aucun code distant ni regex distante n'est exécuté. Les origines réseau
restent explicites et les DTO Zod stricts à chaque frontière.
Lorsqu'un titre humain corrobore exactement un slug débarrassé d'un identifiant
de routage, sa casse et sa ponctuation deviennent le titre d'affichage tandis
que la clé d'identité reste normalisée.
Un slug technique alphanumérique mixte d'au moins six caractères peut aussi
être remplacé par un titre humain unique; les petits nombres terminaux
intrinsèques à un titre restent exclus de cette détection.

L'outbox reste dans `tobirink-private`, jamais dans la base de notifications.
Source/artefact/tâche sont atomiques avant réseau; claims indexés par lane,
état/échéance, au plus huit tâches et 20 s par réveil. L'identité, le lien Work
et le reçu sont commités atomiquement dès la preuve; l'hydratation plus riche
peut être réparée séparément. Les checkpoints et cadences
survivent à MV3; réseau au-moins-une-fois et effets locaux idempotents.
Les migrations des anciens v6/v7/v8 sont additives et préservent les décisions
humaines; les pending d'import sont masquées et réenfilées avec reçus.

L'audit vivant du 2026-09-11 impose une précision opérationnelle : la limite
de 100 claims est une limite **par tranche**, jamais une limite de progression
de la file. L'inventaire ne doit pas monopoliser un réveil; après chaque lot,
le runtime exécute des tranches de résolution jusqu'au budget et persiste une
continuation lorsque des tâches restent disponibles. Une alarme reprend cette
continuation même sans événement de favori. Il n'existe pas aujourd'hui de
queue Worker privée : le Worker sert le cache public D1 vérifié et les données
publiques; une queue Cloudflare privée nécessiterait un ADR séparé.

Une URL sans route connue ne suffit pas à conclure `IDENTITY_MISSING` lorsque
le titre du favori ou un slug local fournit une requête bornée. Le parseur doit
produire `UNKNOWN` et laisser les lanes anime et manga décider selon leurs
preuves. `UNSUPPORTED` reste réservé aux dispositions explicitement exclues,
aux routes utilitaires et aux identités numériques sans titre exploitable.

## Conséquences

La comparaison parcourt les segments humains de l’URL avant de conclure à
une identité manquante. Les queues numériques isolées restent du routage,
jamais une saison implicite. Une route inconnue peut produire une requête
issue du titre avec provenance et sans preuve URL. Les exclusions utilitaires
restent prioritaires. Les adaptateurs nouveaux versionnent seulement les
artefacts affectés; les clés publiques inchangées sont conservées.

L’adaptateur generic-url-corroborated-v1 accepte un slug humain exactement corroboré par le titre même
sur une route générique inconnue, avec type UNKNOWN et vérification publique
inchangée. Les exclusions racine/utilitaire restent prioritaires. La version
de cet adaptateur réenfile les seules routes nouvellement reconnues à la
prochaine réimportation, sans invalider les autres clés publiques.
Le statut distingue les attentes du cache et les erreurs locales; le code
technique du dernier diagnostic est visible sans titre, URL ou erreur brute.

TobiRink ne lit aucune base ni aucun export FavLib pendant sa validation. Un
harness local peut exécuter le parseur du commit épinglé, chargé par `git show`
et transpilé en mémoire dans un contexte sans module, processus, réseau ou accès
fichier. Le digest du fichier est vérifié avant exécution; aucune source FavLib
n'est copiée dans le dépôt. Les
82 cas synthétiques versionnés forment un corpus clean-room indépendant couvrant
artefact, type, progression, identité, décision et raison. Le bilan 77/4/1
décrit les décisions prises sur ce corpus; il ne mesure pas une bibliothèque
privée et ne revendique pas une parité avec le produit historique.

Le réseau fournisseur est exécuté hors extension par le consumer Queue natif,
via la gateway isolée lorsque l'egress direct est refusé.
MV3 transmet au Worker seulement les titres bornés ou l'ID exact; URL brute,
dossiers, progression et historique ne quittent pas le stockage privé.
`npm run verify`, tests installés Chromium/Firefox, migrations, SQL, quotas,
MV3, WebBridge et ZIP reproductibles sont requis avant publication séparée.
