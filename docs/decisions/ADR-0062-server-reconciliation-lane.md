---
scope:
  - apps/worker/src/catalogue/public-discovery-routes.ts
  - apps/worker/src/catalogue/public-discovery-queue.test.ts
  - apps/extension/scripts/installed-review.mjs
  - apps/extension/scripts/installed-review-network.mjs
  - apps/extension/scripts/installed-review.test.mjs
  - scripts/infra/discovery-reconcile.mjs
  - scripts/infra/discovery-reconcile.test.mjs
  - docs/architecture/src/discovery-recovery.dataflow.json
review: on-change
revised: true
---

# ADR-0062 — Voie de réconciliation serveur bornée

Date : 2026-09-26

Statut : proposé

## Contexte

Le navigateur conserve les favoris et leurs identités privées, mais il ne doit
pas devenir le collecteur fournisseur. Les canaris prouvent que Worker, Queue
et Deno convergent lorsqu'une admission v3 existe ; le profil réel montre en
revanche que l'observation seule ne crée aucune admission.

## Décision

Ajouter un runner opératoire qui reçoit des soumissions v3 déjà construites par
le code Tobirink, par défaut en `dry-run`. Une exécution appliquée :

- sélectionne au plus 50 clés, avec un plafond usuel configurable inférieur ;
- refuse les doublons de fingerprint et conserve le payload v3 exact ;
- envoie au plus un POST par clé et réutilise l'idempotence du Worker ;
- s'arrête immédiatement sur 429, 503 (Queue/capacité) ou toute réponse
  inattendue ;
- n'écrit jamais de SQL et ne réarme aucune ligne historique ;
- ne journalise ni titre, ni URL, ni payload privé.

La génération des soumissions reste dans la surface privée de l'extension ou
d'un export local explicitement autorisé. Le runner n'ajoute pas d'endpoint
public non authentifié et ne remplace pas la Queue `claim(1)`/concurrency `1`.
Le test installé peut capturer les soumissions exactes dans des fichiers locaux
`0600` tout en gardant un budget de mutation nul ; il ne journalise jamais leur
contenu et ne les transmet pas au Worker pendant cette phase.
En mode `worker-direct`, un premier passage qui consomme un essai sans résultat
terminal n'est accepté en `202` que si le Worker a effectivement programmé une
continuation Queue différée. Si cette programmation échoue, la réponse reste
`503` et le runner s'arrête ; aucun état `PENDING` n'est présenté comme livré.
Toute exécution distante appliquée passe par le workflow protégé et une
confirmation immédiate du lot exact.

## Conséquences

Cette voie supprime le goulot d'admission du navigateur sans promettre que les
1 522 favoris deviennent tous `VERIFIED` : les œuvres ambiguës, introuvables
ou non supportées restent visibles avec leur raison. Le dry-run permet de
vérifier le nombre de clés et le digest avant toute mutation distante.
