---
scope:
  - apps/worker/**
  - apps/worker/package.json
  - apps/worker/tsconfig.json
  - packages/application/src/collective-index/**
  - packages/adapters-cloudflare/**
  - packages/adapters-cloudflare/package.json
  - packages/adapters-cloudflare/tsconfig.json
  - packages/contracts/src/collective-index/**
  - packages/contracts/package.json
  - package.json
  - package-lock.json
  - docs/architecture/src/tobirink.architecture.json
review: on-change
---
# ADR-0033 — Index collectif consenti et révocable

- Status: accepted
- Date: 2026-09-04

## Contexte

Une décision Review validée peut améliorer la résolution publique, mais une
contribution distante ne doit révéler ni le titre consulté, ni son URL, ni la
bibliothèque, ni la progression d’une personne. Le serveur doit également
résister au rejeu et aux contributions illimitées sans rendre D1 autoritaire
pour les données privées.

## Décision

Une activation explicite crée un consentement opaque avec deux secrets locaux :
un secret d’écriture et un secret de révocation. D1 ne conserve que leurs
empreintes SHA-256. Une contribution contient exclusivement un identifiant
canonique Tobirink, un fournisseur public, son identifiant public, un nonce et
la date de décision. Les schémas HTTP sont stricts et rejettent tout champ
supplémentaire, notamment titre, URL, bibliothèque ou progression.

Chaque nonce est unique dans un consentement. Une requête préparée conditionne
l’écriture à un consentement actif, au secret d’écriture valide et au quota
journalier configuré. La révocation authentifiée rend immédiatement le
consentement inutilisable sans supprimer les associations publiques déjà
agrégées. Les réponses ne réexposent aucun secret hormis lors de la création.

Le cas d’usage dépend de ports pour l’index, l’horloge et les identifiants
cryptographiques. Hono et les bindings D1 restent dans les adaptateurs Worker.
La configuration utilise des types générés par Wrangler. Aucun appel REST à
l’API Cloudflare n’est effectué par le Worker.

## Conséquences

L’index est facultatif, pseudonyme, révocable et reconstructible. Une perte du
secret local exige un nouveau consentement. Les journaux ne doivent jamais
contenir les secrets, corps, identifiants d’œuvre ou identifiants externes.
Créer ou appliquer une ressource D1 reste une opération séparée soumise au gate
infrastructure et à une autorisation explicite.
