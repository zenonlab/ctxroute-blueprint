---
scope:
  - packages/public-discovery/**
  - scripts/public-discovery/**
  - .github/workflows/public-discovery-collector.yml
  - packages/application/src/public-discovery/**
  - packages/adapters-browser/src/catalogue/**
  - packages/adapters-cloudflare/src/catalogue/**
  - apps/worker/src/catalogue/**
  - apps/worker/src/native-collectors.ts
  - apps/worker/src/native-collectors.test.ts
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
- Revised: 2026-09-15

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

Le runtime cible remplace le sondage GitHub par un signal Cloudflare Queue
émis immédiatement après la matérialisation `PENDING`. Ce signal ne contient
que son type et sa version : les titres et la clé restent dans D1. Le consumer
Worker réclame ensuite le lot directement dans D1, applique le bail et les
digests existants, puis acquitte ou reprogramme explicitement le message. La
livraison au moins une fois reste sûre grâce à l’idempotence D1.
Huit retries Queue donnent une neuvième livraison : elle constate le huitième
bail expiré, matérialise `FAILED/ATTEMPT_LIMIT`, ne réclame aucun nouveau lot et
acquitte le signal au lieu de le laisser en DLQ.

Les appels fournisseurs du consumer passent par un transport injecté vers un
proxy sortant hors Cloudflare. L’enveloppe JSON est bornée, horodatée et signée
HMAC-SHA-256. Le proxy refuse toute cible ou méthode hors de la liste exacte
AniList, MangaUpdates, MangaDex et Kitsu, les redirections, les réponses de
plus de 512 Kio, les signatures invalides, les requêtes expirées et les nonces
rejoués. Un déploiement mono-réplique peut utiliser le registre de nonces borné
en mémoire; plusieurs répliques exigent un registre partagé avant activation.

Cette racine est publiée sous licence MIT et reste `private: true` au sens npm :
le code peut être public sans autoriser une publication accidentelle sur le
registre. `zod` reste l’unique dépendance d’exécution; TypeScript, Vitest,
et les types Node sont des dépendances de développement épinglées. Le lockfile
autonome doit être résolu depuis ce manifeste par la version npm exécutée sur
le runner public et réussir `npm ci` hors du monorepo.

## Conséquences

La cadence et l’hébergeur du collecteur peuvent changer sans modifier
l’extension ou le Worker. GitHub Actions reste la composition opérationnelle
déployée tant que la Queue, le proxy et leur trafic réel ne sont pas certifiés.
Le Worker n’accepte les audiences Discovery que si les claims OIDC
nomment aussi le dépôt public exact, `refs/heads/main` et
`.github/workflows/collect.yml@refs/heads/main`; les workflows de forks et de
pull request ne reçoivent donc aucune autorité D1.

Le contrat actif est la version `3`, alignée sur les routes HTTP publiques v3,
avec des lots de cinquante demandes au maximum, deux listes de quatre titres au
maximum et les issues terminales `VERIFIED`, `NOT_FOUND` et `AMBIGUOUS`. Le
passage depuis l’ancien numéro interne `2` renomme les symboles et tables
actifs sans modifier les clés ni perdre les demandes déjà matérialisées.

Le candidat local Queue supprime l’attente de cadence : un cache miss programme
le traitement dès la création `PENDING`. Sa présence dans le dépôt ne prouve ni
la création des ressources Cloudflare, ni le secret partagé du proxy, ni le
déploiement. Les routes OIDC et le dépôt public restent donc un rollback
opérationnel jusqu’à une bascule séparée et vérifiée; leur suppression demande
une approbation destructive distincte.
