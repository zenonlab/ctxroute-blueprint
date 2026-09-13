# Plan de correction Agenda

La correction est découpée dans
`docs/plans/restore-agenda-pipeline.json`. Chaque étape possède son périmètre,
ses critères, ses tests et son commit. Les étapes 1 à 11 sont locales et
réversibles. L'étape 12 est une opération Cloudflare séparée avec allowlist,
hashes, sauvegarde et rollback.

Ordre de données :

```text
AniList / MangaUpdates
        ↓ collecte quotidienne Worker
        ↓ D1 public borné
        ↓ GET /v2/releases + ETag + curseur
        ↓ IndexedDB génération atomique
        ↓ jointure locale par providerWorkId
        ↓ Agenda / rappels / WebBridge local
```

La collecte ne reçoit jamais de favori ni d'identifiant d'installation. Une
panne d'une lane conserve l'autre lane et les données précédentes. Kitsu ne
devient jamais arbitre du calendrier.

Les bornes sont : fenêtre J−1/J+15, 24 heures entre rafraîchissements,
pagination limitée, 12 observations manga, 8 intervalles, 3 intervalles
minimum, 0,5×–2× médiane, aucun scan complet local et aucun envoi de donnée
privée.

La reconstruction après reset est : favoris navigateur → IDs
`storage.sync` → identités D1 via Worker → hydratation locale → calendrier
public → projection → alarmes. Chaque génération précédente reste récupérable
jusqu'au reçu de validation.
