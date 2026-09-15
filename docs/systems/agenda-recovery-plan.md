# Plan de correction Agenda

## Incident de collecte partagée — 14 septembre 2026

La demande produit impose une collecte partagée couvrant deux semaines et la
réutilisation du travail entre tous les utilisateurs. Depuis le 15 septembre
2026, un cron Worker toutes les dix minutes dépose `agenda-refresh` dans la
Queue native. Son consumer appelle AniList et MangaUpdates via la gateway
isolée, puis publie directement la génération D1. `GET /v3/releases` sert la
génération active. Les preuves locales restent distinctes de cette observation
de production.

Une réponse `d1-empty` signifie qu'aucune génération n'est publiée. Une
génération publiée avec zéro événement signifie que sa fenêtre a été vérifiée :
le chargeur la conserve et l'extension ne relance pas les fournisseurs pour
cette seule raison. Un ETag ne se réutilise que pour un cache partagé de même
fenêtre; un 304 sans ce cache est rejeté. La durée du cache client reste pour
l'instant de 24 heures, distincte de la cadence hebdomadaire demandée.

Implémentation active : le consumer Queue collecte la fenêtre J−1/J+15 toutes
les dix minutes. Il ne publie rien si une lane échoue. Le Worker vérifie le
schéma strict de la génération, dérive une révision SHA-256 idempotente,
écrit par lots préparés et ne remplace jamais l'actuelle par une génération
plus ancienne. Rejouer le même lot n'ajoute aucun événement. `GET /v2/releases`
reste le contrat compatible; `GET /v3/releases` expose en plus la fenêtre
source. Ces deux routes sont des lectures D1 pures et ne déclenchent aucune
collecte.

L’ingestion Agenda ne contient que des événements publics et ne transmet aucun
profil hydraté par l’extension. La découverte favorite est une pipeline séparée
définie par l’ADR-0046 : le premier miss crée un claim `PENDING` sans titre brut;
le client ne publie aucun identifiant; seul le consumer Queue natif peut
hydrater, vérifier puis promouvoir une fiche `VERIFIED`. Il n’existe
plus de consentement Collectif, owner, appairage ou activation automatique.

Les routes Catalogue v2 répondent `410`; cette retraite est indépendante de la
compatibilité Agenda de `GET /v2/releases`. Il faut mesurer séparément les
œuvres catalogue vérifiées, les demandes en attente et les sorties Agenda
actives. Une ligne `PENDING` prouve seulement qu’un travail a été réservé; elle
n’est jamais comptée ni servie comme métadonnée fiable.

Le consumer respecte les limites publiques des fournisseurs et s'arrête sur
un refus explicite. La collecte planifiée réussie et la génération D1 active
certifient le chemin publié; un nouvel incident doit encore être diagnostiqué
séparément entre collecte, ingestion et lecture.

## Plan initial et architecture cible

La correction est découpée dans
`docs/plans/restore-agenda-pipeline.json`. Chaque étape possède son périmètre,
ses critères, ses tests et son commit. Les étapes 1 à 11 sont locales et
réversibles. L'étape 12 est une opération Cloudflare séparée avec allowlist,
hashes, sauvegarde et rollback.

Ordre de données cible :

```text
AniList / MangaUpdates
        ↓ collecteur planifié à egress vérifié
        ↓ batch public signé vers le Worker
        ↓ D1 public borné, écrit uniquement par le Worker
        ↓ GET /v3/releases + fenêtre source + ETag + curseur
        ↓ IndexedDB : génération complète et atomique
        ↓ jointure locale par providerWorkId
        ↓ Agenda / rappels / WebBridge local

Si D1 est temporairement indisponible :
dernière génération partagée IndexedDB de même fenêtre et âgée de moins de huit jours
        ↓ aucune API fournisseur depuis MV3
        ↓ sinon état Agenda indisponible jusqu’au prochain traitement Queue
```

La collecte ne reçoit jamais de favori ni d'identifiant d'installation. Une
panne d'une lane conserve la génération D1 active précédente. Kitsu ne devient
jamais arbitre du calendrier. L'extension ne collecte aucune sortie fournisseur
et ne contribue aucun événement à D1.

Les bornes sont : fenêtre J−1/J+15, 24 heures entre rafraîchissements,
50 résultats par page AniList, taille MangaUpdates déterminée par `per_page`
retourné, une page par effet MV3, 2,2 secondes entre appels AniList, 3 secondes
entre appels MangaUpdates, 12 observations manga, 8 intervalles, 3 intervalles
minimum, filtre `0,5×–2×` médiane et aucun envoi de donnée privée.

AniList produit des événements `INSTANT`. MangaUpdates produit des événements
`DATE`; `time_added` reste une provenance d'observation et ne devient jamais
une heure de sortie. Les numéros de sortie restent des chaînes bornées afin de
conserver décimales, suffixes et plages.

La reconstruction après reset est : favoris navigateur → demandes Discovery
v3 via Worker → identités publiques vérifiées D1 → calendrier public →
projection locale → alarmes. La génération active et les deux précédentes
restent récupérables. Le chargeur partagé refuse une génération âgée d'au moins
huit jours ou dont la fenêtre ne couvre pas la requête; il échoue fermé sans
appel fournisseur MV3 ni altération de D1.
