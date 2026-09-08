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
Kitsu une recherche principale indisponible. L'oracle synthétique 77/4/1 ne
prouvait pas la parité réelle. La référence normative est la doctrine FavLib
`3267de2`, précisée par la demande du 2026-09-08.

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

## Conséquences

L'oracle réel FavLib est lu seul, hors dépôt; seuls les cas synthétiques sont
versionnés. Environ 40 ambiguïtés/4 introuvables est un repère à mesurer, jamais
un comptage forcé. Différences comparées sur artefact/type/progression/identité/
décision/raison; aucune différence inexpliquée ne valide la parité.

Le réseau fournisseur est exécuté par l'extension avec disclosure
`bookmarksInfo` Firefox. Seuls titre analysé ou ID exact sont transmis aux
fournisseurs; seul le payload minimal ADR-0033 va au Worker. URL brute,
dossiers, progression et historique ne quittent pas le stockage privé.
`npm run verify`, tests installés Chromium/Firefox, migrations, SQL, quotas,
MV3, WebBridge et ZIP reproductibles sont requis avant publication séparée.
