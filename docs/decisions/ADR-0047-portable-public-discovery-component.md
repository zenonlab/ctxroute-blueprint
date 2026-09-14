---
scope:
  - packages/public-discovery/**
  - scripts/public-discovery/**
  - .github/workflows/public-discovery-collector.yml
  - packages/application/src/public-discovery/**
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-cloudflare/src/catalogue/**
  - apps/worker/src/catalogue/**
  - apps/worker/migrations/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/wxt.config.ts
  - docs/architecture/src/public-discovery.dataflow.json
review: on-change
---

# ADR-0047 — Composant portable de découverte publique

- Status: accepted
- Date: 2026-09-14

## Contexte

Le script de vérification importe directement l’application et les adaptateurs
TobiRink, lit `process.env` et connaît les routes de production. Il ne peut pas
être extrait dans un autre dépôt sans copier le monorepo et sa composition.
L’extension possède en parallèle les mêmes adaptateurs fournisseurs, ce qui
duplique l’autorité réseau et les permissions.

## Décision

Créer `@tobirink/public-discovery` comme composant TypeScript autonome. Son
manifeste ne dépend d’aucun package `@tobirink/*`; son API publique reçoit des
ports injectés pour lire un lot de demandes, résoudre une demande, publier les
résultats et fournir l’horloge, le nonce et les limites. Le composant ne lit ni
variable d’environnement, ni secret, ni API GitHub, ni binding Cloudflare.

Le contrat ferme les fournisseurs à `anilist`, `mangaupdates`, `mangadex`,
`kitsu-anime` et `kitsu-manga`. Un résolveur injecté possède la recherche, le
matching et l’hydratation. Le moteur portable orchestre les lots, isole un échec
transitoire par demande, refuse les résultats dont la clé ou le digest diffère,
et publie seulement des objets JSON validés. Il ne transporte jamais `Request`,
`Response`, `Error`, fonction ou instance de classe à travers ses ports.

Le dépôt TobiRink conserve deux compositions minces : un adaptateur HTTP vers
les routes Worker et un résolveur multi-fournisseurs construit avec les
adaptateurs existants. Le point d’entrée GitHub Actions obtient ses jetons OIDC,
injecte ces deux ports et appelle une seule fonction du composant. Les URLs,
audiences et variables d’environnement restent dans ce point d’entrée, jamais
dans le composant extractible.

Le package expose un export public stable, un test avec ports mémoire et un
contrôle d’isolation qui échoue sur tout import `@tobirink/*`, API navigateur,
binding Cloudflare ou lecture de `process.env`. Il doit pouvoir être copié dans
un dépôt indépendant avec `zod` comme seule dépendance d’exécution.

## Conséquences

La cadence et l’hébergeur du collecteur peuvent changer sans modifier
l’extension, le Worker ou le moteur. GitHub Actions reste la composition
opérationnelle initiale et son OIDC garde l’autorité de publication. Le package
portable n’accorde à lui seul aucun accès à D1 ou aux fournisseurs : ces
capacités viennent exclusivement des ports fournis par le dépôt qui l’appelle.
