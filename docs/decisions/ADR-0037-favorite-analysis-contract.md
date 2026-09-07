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
review: on-change
revised: true
---

# ADR-0037 — Versionner le contrat d’analyse et de résolution des favoris

- Status: accepted
- Date: 2026-09-07
- Revised: 2026-09-07

## Contexte

L’audit du moteur FavLib a retrouvé des règles utiles de parsing de titre,
d’identité URL, de saison, de progression et de matching fournisseur. Elles
étaient toutefois réparties entre un parser dense, un module metadata
monolithique, une file locale et un background MV3. Certaines règles se
chevauchaient et l’architecture laissait les favoris navigateur concurrencer la
base locale.

TobiRink importe les favoris HTTP(S) en `FavoriteSource` et `Review`; la
résolution composée est désormais portée par une outbox locale et des ports
fournisseur séparés. Réécrire sans contrat ferait perdre des cas qui protègent notamment
les saisons, les nombres intrinsèques aux titres, les slugs techniques et les
ambiguïtés fournisseur.

## Décision

Adopter
[`favorite-parsing-resolution-spec.md`](../systems/favorite-parsing-resolution-spec.md)
comme contrat canonique préalable à la réécriture.

Conserver les entrées brutes et toutes les transformations dans un artefact
versionné. Séparer les preuves d’identité, de saison et de progression. Toute
politique de matching est pure, symétrique entre fournisseurs et exige une
unique identité distincte à chaque niveau. Identifiant et URL exacts précèdent
le titre exact, la saison explicitement corroborée, les mots significatifs
réordonnés et la distance d’édition bornée. Popularité, rang, ordre, date,
image, inclusion partielle et richesse de fiche ne sont jamais des preuves.
La décision pure implémente les six niveaux dans cet ordre. Elle applique avant
comparaison la compatibilité symétrique de nature, OVA et pré-sérialisation.
La taxonomie hydratée est normalisée exactement et filtre le candidat sans
jamais devenir une preuve ni un score.

La capture borne mais ne qualifie pas la chaîne URL. La qualification possède
seule les dispositions `INVALID_URL` et `NON_WEB_URL`; une preuve rejetée ne
peut contenir aucun champ d’identité actionnable. Une URL canonique éventuelle
doit conserver l’origine explicitement déclarée.

Conserver la reprise MV3 dans une file IndexedDB durable dont l’entrée est
écrite avant le réseau. Recherche, hydratation exacte et contribution Review
sont des étapes et ports séparés d’une même tâche durable de résolution. Les effets sont idempotents et les attentes
longues sont persistées plutôt que gardées en mémoire.

Implémenter les tâches de résolution comme une outbox du même schéma
`tobirink-private` que `FavoriteSource`, `Review` et les artefacts afin que leur
création soit atomique. Réutiliser les transitions pures de tâche existantes,
mais pas l’adaptateur `tobirink-durable-tasks` des notifications : sa base
séparée ne fournit pas cette atomicité et sa sélection actuelle parcourt tous
les états disponibles. Les claims de résolution sont bornés par des index de
type, lane, état et échéance.
Le schéma IndexedDB v6 matérialise cette décision avec `favoriteArtifacts` et
`favoriteResolutionTasks`. Un premier import écrit les quatre enregistrements
dans une transaction; une réimportation conserve l’instant d’import et ne
duplique pas la tâche stable. La lane de routage est explicite et chaque tâche
possède toujours `availableAt`.

Exiger que chaque réponse de candidats indique si l’ensemble pertinent est
complet ou tronqué. Un ensemble incomplet ne peut jamais produire une
correspondance automatique, même si un seul candidat visible correspond. Les
lanes AniList et MangaUpdates appliquent séparément leurs cadences; l’ordre de
leurs réponses ne modifie pas le résultat du matcher.
Les recherches de candidats et l’hydratation par identifiant utilisent deux
ports applicatifs distincts. Le routage par titre réserve AniList à l’anime,
MangaUpdates aux mangas, manhwa et manhua, et dédouble seulement le type inconnu;
une référence AniList explicite peut toutefois hydrater exactement un manga
AniList sans recherche de titre.
Les adaptateurs HTTP valident leurs DTO externes avec les schémas Zod déjà
retenus par le projet avant toute conversion en candidats du domaine; leurs
réponses et délais restent bornés au point d’entrée réseau.

Maintenir ADR-0025 : IndexedDB est la seule autorité privée. Les favoris sont
des commandes d’import et leur suppression ne supprime pas une œuvre ou une
progression. Maintenir ADR-0033 : toute contribution collective exige un
consentement distinct, révocable et revérifié.

Rejeter le portage direct des modules FavLib. La réécriture utilise des contrats
et modules TobiRink séparés, un corpus synthétique local et une matrice de
traçabilité. Les anciennes versions servent seulement de référence
comportementale.

Définir l’équivalence sur le résultat métier, pas sur la forme JSON historique :
77 cas sont conservés, `U-02`, `U-10`, `B-03` et `O-02` sont corrigés, et
`X-01` reste exclu tant que MangaDex n’est pas activé. Un oracle synthétique
compare artefact, décision et projection sans appeler un fournisseur vivant.
La commande racine `npm run verify` exécute cet oracle avec tous les tests de
workspaces, le typecheck et les budgets de performance avant les gates de
livraison documentaire.
Le module de langue de document reste un enrichissement local facultatif,
séparé du parser de favoris; OVA et pré-sérialisation appartiennent à la
compatibilité candidat, et la taxonomie éditoriale s’applique après hydratation.

## Conséquences

Chaque changement de règle exige une version, une fixture synthétique, une
comparaison d’artefact complet et une migration ou invalidation explicite. Les
ambiguïtés deviennent visibles dans Review au lieu d’être masquées par un
classement fournisseur.

Une observation trop grande ou une réponse fournisseur tronquée échoue fermée
vers Review au lieu de tronquer silencieusement les preuves. `NO_MATCH` conserve
une Review `no-match` et ne crée pas de `Work`. Les artefacts et tâches
techniques sont compactés selon une politique bornée sans supprimer les sources,
Reviews, œuvres ou progressions autoritaires.

Le runtime compose désormais les événements favoris, l’import atomique, les
adaptateurs AniList/MangaUpdates, le runner borné et les écritures
`FavoriteSource`, `Review`, `Work` et Bibliothèque. Les suppressions deviennent
une présence `detached` et ne cascadent jamais. L’inventaire navigateur reste
un rescan `getTree()` coalescé; son remplacement par des tranches durables est
requis avant de déclarer la scalabilité locale complète. Cette révision
n’ajoute aucune permission hôte, contribution cloud ou opération de déploiement.
