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
revised: true
---
# ADR-0033 — Collectif SQL owner-scoped et révocable

- Status: accepted
- Date: 2026-09-04
- Revised: 2026-09-08

## Contexte

L'association TobiRink-ID/fournisseur seule ne permettait pas de retrouver une
œuvre depuis la clé d'un favori. La doctrine `3267de2` exige une préférence
personnelle et des confirmations de propriétaires distincts, sans bibliothèque
privée distante.

## Décision

Le Worker HTTP typé est seul détenteur du binding D1 et seul auteur des
écritures serveur. Site, sessions et WebBridge ne possèdent aucun accès D1.
Les ports applicatifs séparent HTTP, authentification, index et SQL préparé.
Les migrations sont exécutables uniquement par la gate opérationnelle,
jamais par une route de session. Aucune écriture Cloudflare n'est activée par
l'étape documentaire.

Une migration additive crée règles versionnées, owners opaques, installations
appairées, clés de titres normalisées hachées, associations personnelles vers
plusieurs IDs publics, décisions/conflits, confirmations owner-distinctes,
nonces et reçus batch. Les tables de catalogue existantes restent séparées.
Ni titre brut, URL, dossier, progression ni payload fournisseur dans ces tables.
Une empreinte de titre devinable n'est pas une anonymisation; elle reste privée.

La préférence owner-scoped est prioritaire. Une association partagée exige au
moins deux propriétaires distincts confirmant explicitement la même identité
pour une clé produite indépendamment. Deux installations appairées d'un owner
comptent une seule fois. Un conflit conserve chaque choix personnel et interdit
le vote comme départage automatique. Le protocole limite l'abus mais ne prouve
pas l'indépendance réelle de propriétaires malveillants coordonnés.

Consentement explicite et révocable. L'extension détient l'identité opaque,
les secrets d'installation et de révocation dans storage.local de confiance.
D1 conserve leurs empreintes seulement; le site et sync ne reçoivent jamais
ces secrets. L'appairage est explicite, borné dans le temps et anti-rejeu.
Les tests utilisent des credentials synthétiques.

Chaque requête contient uniquement clé hachée, média, IDs publics, versions,
nonce et authentification. Corps ≤64 Kio, batch ≤50 clés/associations,
≤5 références par association. Le Worker dérive owner et temps serveur,
valide schéma strict, installation, consentement et quota. Requêtes préparées
et `D1.batch` rendent atomiques nonce, association, confirmation et reçu.
Même batch/digest authentifié : reçu idempotent; même nonce/contenu différent :
rejet. Lookup groupé indexé, owner prioritaire, aucun N+1 ou scan non borné.

## Conséquences

Le [plan canonique v3](../systems/favorite-resolution-correction-plan.md)
définit les tables logiques, requêtes, index et migrations. Les tests locaux
prouvent isolation, anti-rejeu, quotas, concurrence et plans SQL. Révocation
bloque les futures contributions sans supprimer automatiquement les données.
Aucun secret, corps, titre ou identifiant privé dans les journaux. Publication,
appairage réel et migrations de production restent des opérations séparées.
