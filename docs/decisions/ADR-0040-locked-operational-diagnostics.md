---
scope:
  - apps/worker/**
  - apps/extension/runtime/**
  - apps/extension/wxt-entrypoints/background.ts
  - apps/extension/entrypoints/options/ResolutionStatus/**
  - apps/provider-gateway/src/**
  - packages/application/src/favorites/favorite-resolution-runner.ts
  - scripts/infra/manga-canary.mjs
  - scripts/infra/manga-canary.test.mjs
  - docs/systems/favorite-resolution-rebuild-pipeline.md
  - docs/architecture/src/favorite-resolution.dataflow.json
review: on-change
revised: true
---

# ADR-0040 — Diagnostics opérationnels verrouillés

- Status: accepted
- Date: 2026-09-12

## Context

La file de résolution MV3 peut s'interrompre sans que l'état local permette de
distinguer une absence d'inventaire, une reprise, une erreur interne ou une
réponse Worker. Le diagnostic ne doit jamais créer une nouvelle copie des
données privées des favoris.

## Decision

Le Worker émet des événements JSON versionnés uniquement lorsque la variable
non secrète `TOBIRINK_WORKER_DIAGNOSTICS` vaut exactement `worker-v1`. Chaque
événement contient une famille de route fermée, la méthode réduite, le statut,
une durée bornée et un identifiant de corrélation aléatoire. Le chemin, les
paramètres, les en-têtes, les corps et les erreurs brutes sont exclus.

L'extension conserve au plus 100 événements versionnés dans `storage.local`
uniquement lorsque `tobirink.extensionDiagnostics` vaut exactement
`extension-v1`. Les événements décrivent les phases d'inventaire et de
résolution, leurs compteurs bornés et un code d'échec fermé. Ils ne contiennent
ni titre, ni URL, ni dossier, ni progression, ni identifiant fournisseur, ni
secret. La page Options de confiance lit l'état et active ou désactive le
verrou par un booléen. Le runner trace aussi l'admission, l'attente Queue, le
résultat fournisseur et le commit `VERIFIED` avec des champs bornés. Le Worker
et la gateway acceptent un booléen de debug de composition, désactivé par
défaut côté déploiement. Ces événements restent locaux et sont exclus de
`storage.sync`, des exports, de WebBridge et du Worker.

Les échecs du runner émettent le même événement borné avec un code fermé,
y compris les erreurs de provider, de parsing, de claim et de commit. Le
runner traite au plus quatre claims indépendants en parallèle par tranche;
les claims restent atomiques et chaque lane fournisseur conserve ses limites.

Les logs de requête natifs de Cloudflare suivent la configuration de la
plateforme; le verrou Worker gouverne les événements applicatifs Tobirink.
Lorsqu'une admission `worker-direct` programme une continuation, son UUID
aléatoire non privé traverse uniquement le signal Queue et les diagnostics de
coût. Le canari peut ainsi additionner les lectures et écritures D1 de chaque
passage jusqu'au terminal, sans exposer la clé, le titre ni la requête métier.
Le signal porte séparément un jeton de sélection aléatoire à usage unique. D1
n'en conserve que le SHA-256 dans `claim_token_hash`; le consumer doit posséder
le jeton exact pour reprendre cette ligne, puis le remplace par son propre jeton
de publication. Le jeton brut n'entre jamais dans un diagnostic.
Une continuation étrangère, orpheline ou portant un coût cumulé supérieur à
300 lectures D1 ne peut pas certifier l'admission.

## Consequences

Une exécution peut être corrélée entre son statut HTTP et une famille de route
sans exposer le contenu traité. La valeur `off`, une valeur absente ou toute
valeur inconnue désactive le mécanisme. La taille locale reste bornée et une
panne du diagnostic ne bloque jamais la résolution. Désactiver le booléen ne
modifie ni les claims, ni les baux, ni les retries, ni les résultats métier.
