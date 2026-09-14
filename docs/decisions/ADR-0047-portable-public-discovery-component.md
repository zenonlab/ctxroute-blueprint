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
revised: true
---

# ADR-0047 — Composant portable de découverte publique

- Status: accepted
- Date: 2026-09-14
- Revised: 2026-09-14

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

Le package porte aussi sa composition autonome : adaptateur HTTP vers les
routes Worker, matching borné, adaptateurs AniList, MangaUpdates, MangaDex,
Kitsu Anime et Kitsu Manga, puis point d’entrée GitHub Actions. Ce dernier
obtient ses jetons OIDC temporaires et appelle la même fonction publique. Les
URLs, audiences et variables d’environnement restent dans le CLI, jamais dans
le moteur injectable.

Le package expose un export public stable, un test avec ports mémoire et un
contrôle d’isolation qui échoue sur tout import `@tobirink/*` ou identifiant
ressemblant à un secret. Il doit pouvoir être extrait par `git subtree` comme
racine du dépôt public `tristan-monticelli/tobirink-public-discovery`.

Cette racine est publiée sous licence MIT et reste `private: true` au sens npm :
le code peut être public sans autoriser une publication accidentelle sur le
registre. `zod` reste l’unique dépendance d’exécution; TypeScript, Vitest,
esbuild et les types Node sont des dépendances de développement épinglées.

## Conséquences

La cadence et l’hébergeur du collecteur peuvent changer sans modifier
l’extension ou le Worker. GitHub Actions reste la composition opérationnelle
initiale. Le Worker n’accepte les audiences Discovery que si les claims OIDC
nomment aussi le dépôt public exact, `refs/heads/main` et
`.github/workflows/collect.yml@refs/heads/main`; les workflows de forks et de
pull request ne reçoivent donc aucune autorité D1.

La première implémentation matérialise ce contrat en version `2`, avec des lots
de cinquante demandes au maximum et les issues terminales `VERIFIED`,
`NOT_FOUND` et `AMBIGUOUS`.

Le workflow initial sonde la file une fois par jour à 03:23 UTC et accepte un
déclenchement manuel. Une demande est donc dédupliquée dans D1 immédiatement,
mais sa fiche peut rester `PENDING` jusqu’au prochain passage. Cette cadence
borne le nombre de runs GitHub Actions; elle ne constitue pas une garantie de
gratuité et peut être révisée indépendamment du package.
