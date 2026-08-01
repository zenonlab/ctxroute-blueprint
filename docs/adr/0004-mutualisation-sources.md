# ADR 0004 — Mutualisation des sources

- Statut : accepté
- Date : 2026-08-02

## Contexte

Une même URL peut retourner des sorties différentes selon région, langue, headers, version du connecteur ou mode d'accès. Mutualiser uniquement par URL serait incorrect.

## Décision

Une cible de collecte est identifiée par :

```text
connector_id
+ connector_version
+ canonical_check_url
+ locale
+ region
+ access_mode
+ representation_variant
```

`access_mode` vaut `public_shared` ou `extension_private`. Seules les cibles `public_shared` dont tout le contexte est identique sont vérifiées et mises en cache ensemble.

Une cible `extension_private`, authentifiée, personnalisée ou dépendante de cookies reste reliée à un seul utilisateur/appareil et n'est jamais traitée par le worker public commun.

Le passage à une nouvelle version de connecteur crée un nouveau contexte de snapshot ; l'ancien état reste disponible pour comparaison et rollback.

## Conséquences

La mutualisation économise réellement des requêtes sans confondre catalogues régionaux ou représentations différentes.
