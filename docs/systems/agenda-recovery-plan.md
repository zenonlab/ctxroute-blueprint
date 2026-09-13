# Plan de correction Agenda

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
        ↓ GET /v2/releases + ETag + curseur
        ↓ IndexedDB : génération complète et atomique
        ↓ jointure locale par providerWorkId
        ↓ Agenda / rappels / WebBridge local

Si D1 est vide, périmé ou indisponible :
AniList / MangaUpdates
        ↓ pages publiques directes depuis MV3
        ↓ checkpoint et cadence durable par fournisseur
        ↓ même génération IndexedDB atomique
```

La collecte ne reçoit jamais de favori ni d'identifiant d'installation. Une
panne d'une lane conserve l'autre lane et les données précédentes. Kitsu ne
devient jamais arbitre du calendrier. Le repli local ne contribue aucun
événement à D1 et s'arrête dès qu'une génération publique récente et complète
est disponible.

Les bornes sont : fenêtre J−1/J+15, 24 heures entre rafraîchissements,
50 résultats par page AniList, taille MangaUpdates déterminée par `per_page`
retourné, une page par effet MV3, 2,2 secondes entre appels AniList, 3 secondes
entre appels MangaUpdates, 12 observations manga, 8 intervalles, 3 intervalles
minimum, filtre `0,5×–2×` médiane et aucun envoi de donnée privée.

AniList produit des événements `INSTANT`. MangaUpdates produit des événements
`DATE`; `time_added` reste une provenance d'observation et ne devient jamais
une heure de sortie. Les numéros de sortie restent des chaînes bornées afin de
conserver décimales, suffixes et plages.

La reconstruction après reset est : favoris navigateur → IDs
`storage.sync` → identités D1 via Worker → hydratation locale → calendrier
public → projection → alarmes. Chaque génération précédente reste récupérable
jusqu'au reçu de validation.
