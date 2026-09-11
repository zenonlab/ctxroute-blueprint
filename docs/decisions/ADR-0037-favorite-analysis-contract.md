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

# ADR-0037 — Contrat versionné de résolution des favoris

- Status: accepted
- Date: 2026-09-07
- Revised: 2026-09-08

## Contexte

La pipeline précédente créait une Review à l'import et pouvait confier à
Kitsu une recherche principale indisponible. La reconstruction clean-room doit
fixer les comportements utiles sans reprendre le runtime, le code ou les
données FavLib. La doctrine historique `3267de2` est une source de décisions
revues, précisée puis remplacée par le contrat TobiRink du 2026-09-08.

## Décision

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

Ordre : ID/URL exact, règle origine/route, artefact/aliases, fiche locale
hydratée, lookup owner-scoped via Worker, recherche fournisseur locale,
Review terminale. AniList anime puis Kitsu Anime après NO_MATCH complet;
MangaUpdates manga/manhwa/manhua puis MangaDex dans son rôle exact/sorties,
puis Kitsu Manga. Une référence AniList manga explicite reste hydratable.
Type inconnu : lanes indépendantes, aucune validation unilatérale si l'autre
lane manque; deux identités de types différents imposent Review.

Panne, 429, timeout et réponse incomplète n'autorisent pas le fallback.
Kitsu n'arbitre pas l'ambiguïté principale. Le matcher s'arrête au premier
niveau probant : ID, URL, titre exact, saison corroborée, tokens réordonnés,
distance bornée. Plusieurs identités distinctes sont ambiguës. Popularité,
rang, ordre, couverture et premier résultat sont interdits comme preuves.
OVA/pré-sérialisation restent des compatibilités symétriques; taxonomie
éditoriale s'applique après hydratation, sans fabriquer une identité.

Payload valide, pagination et exhaustivité sont distincts. La limite de
20 candidats est par page; l'absence/unicité doit porter sur l'ensemble
pertinent prouvé, pas sur la première page. Le curseur et jusqu'à trois aliases
sont persistés; budget atteint ou page manquante reste RETRYABLE. Une panne
ne doit pas boucler sur une page déjà attestée ni devenir no-match humain.

L'implémentation locale v3 utilise des checkpoints de pages par fournisseur
dans l'artefact privé, liés au fingerprint et au claim courant. Elle retient
au plus 20 identités au meilleur niveau de preuve, attend la fin des pages et
aliases, puis décide. La pagination normale ne consomme pas les huit tentatives
réservées aux erreurs. `Retry-After` est persisté et peut reporter le réveil.
Les aliases mémorisés dans Work doivent eux-mêmes correspondre à la fiche
hydratée; un libellé libre du favori ne devient pas un alias par simple voisinage.
Le port collectif strict reçoit seulement une clé SHA-256 liée au titre
normalisé/type/saison et les versions; ses références équivalentes sont
hydratées suivant la priorité fournisseur. L'adaptateur HTTP authentifié et
la distribution effective des règles sont raccordés à l'étape Worker/D1.

Parser, matcher, progression, normalisation, règles, décisions et reçus sont
versionnés. Brut et transformations restent locaux. Les règles distribuées
par Worker sont des données JSON bornées origine/segments/type/progression;
aucun code distant ni regex distante n'est exécuté. Les origines réseau
restent explicites et les DTO Zod stricts à chaque frontière.

L'outbox reste dans `tobirink-private`, jamais dans la base de notifications.
Source/artefact/tâche sont atomiques avant réseau; claims indexés par lane,
état/échéance, au plus huit tâches et 20 s par réveil. Résultat, hydratation,
lien Work et reçu sont commités atomiquement. Les checkpoints et cadences
survivent à MV3; réseau au-moins-une-fois et effets locaux idempotents.
Les migrations des anciens v6/v7/v8 sont additives et préservent les décisions
humaines; les pending d'import sont masquées et réenfilées avec reçus.

L'audit vivant du 2026-09-11 impose une précision opérationnelle : la limite
de 100 claims est une limite **par tranche**, jamais une limite de progression
de la file. L'inventaire ne doit pas monopoliser un réveil; après chaque lot,
le runtime exécute des tranches de résolution jusqu'au budget et persiste une
continuation lorsque des tâches restent disponibles. Une alarme reprend cette
continuation même sans événement de favori. Il n'existe pas aujourd'hui de
queue Worker privée : le Worker traite le collectif et la distribution
déclarative; une queue Cloudflare privée nécessiterait un ADR séparé.

Une URL sans route connue ne suffit pas à conclure `IDENTITY_MISSING` lorsque
le titre du favori ou un slug local fournit une requête bornée. Le parseur doit
produire `UNKNOWN` et laisser les lanes anime et manga décider selon leurs
preuves. `UNSUPPORTED` reste réservé aux dispositions explicitement exclues,
aux routes utilitaires et aux identités numériques sans titre exploitable.

## Conséquences

TobiRink ne lit aucune base ni aucun export FavLib pendant sa validation. Les
82 cas synthétiques versionnés forment un corpus clean-room indépendant couvrant
artefact, type, progression, identité, décision et raison. Le bilan 77/4/1
décrit les décisions prises sur ce corpus; il ne mesure pas une bibliothèque
privée et ne revendique pas une parité avec le produit historique.

Le réseau fournisseur est exécuté par l'extension avec disclosure
`bookmarksInfo` Firefox. Seuls titre analysé ou ID exact sont transmis aux
fournisseurs; seul le payload minimal ADR-0033 va au Worker. URL brute,
dossiers, progression et historique ne quittent pas le stockage privé.
`npm run verify`, tests installés Chromium/Firefox, migrations, SQL, quotas,
MV3, WebBridge et ZIP reproductibles sont requis avant publication séparée.
